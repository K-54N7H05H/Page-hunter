import { Spider, Page } from './spider'
import { PagerankMatrix, PagerankLinkIndexer } from './page-rank'
import * as dotenv from 'dotenv'
import * as pg from 'node-postgres'
import { CheerioAPI, Document, Element, Cheerio, AnyNode, load } from 'cheerio'
import { setMaxListeners } from 'events'

dotenv.config()

setMaxListeners(4096)

let pgClient = new pg.Client({
    user: process.env.PAGEHUNTER_DATABASE_USERNAME,
    host: 'localhost',
    database: process.env.PAGEHUNTER_DATABASE,
    password: process.env.PAGEHUNTER_DATABASE_PASSWORD,
    port: 5432
})

pgClient.connect()

let MAX_CRAWL: number = 128

let index: PagerankLinkIndexer = new PagerankLinkIndexer
let matrix: PagerankMatrix = new PagerankMatrix

const htmlInlineElements = new Set(
    `a,abbr,acronym,audio,b,bdi,bdo,big,br,button,canvas,cite,code,data,
    datalist,del,dfn,em,embed,i,iframe,img,input,ins,kbd,label,map,mark,
    meter,noscript,object,output,picture,progress,q,ruby,s,samp,script,
    select,slot,small,span,strong,sub,sup,svg,template,textarea,time,
    tt,u,var,video,wbr`
        .split(",")
        .map((s) => s.trim())
)

function walk(root: AnyNode, enter: (element: AnyNode) => void, leave: (element: AnyNode) => void): void {
    enter(root)
    if (root.type === "tag")
        for (const child of root.children)
            walk(child, enter, leave)
    leave(root)
}

function render_webpage(node: CheerioAPI | Document | string | Element | Cheerio<Element>): string {
    let root: Document | Element | null = null
    if (typeof node === "string") {
        root = load(node)("body")[0]
    } else if (typeof node === "object" && "0" in node) {
        root = node[0]
    } else if (typeof node === "object" && "children" in node && "type" in node) {
        root = node
    }

    if (!root)
        throw new Error("Node should be a string, cheerio loaded element or a cheerio node")

    let text: string = ""

    walk(root, (element: AnyNode): void => {
        if (element.type === "text")
            text += element.data
    }, (element: AnyNode): void => {
        if (element.type === "tag" && !htmlInlineElements.has(element.tagName))
            text += '\n'
    })

    return text.trim().split(/\n+/g).map((line) => line.trim()).filter(Boolean).join()
}

let x = new Spider({
    session: true
}).visit(process.env.PAGEHUNTER_BEGIN || 'https://wikipedia.com', {
    beforeLoad(url: URL) { return --MAX_CRAWL >= 0; },
    visit(page: Page) {
        const PAGE_URL = page.url.toString().trim()
        console.info('[hunter]  Crawling ' + page.url.toString())

        const BODY = render_webpage(page.$("body"))
            .replace(/[\u{0080}-\u{FFFF}]/gu, "")           //  Remove NON-ASCII Characters
            .replace(/[.*+?^${}()|[\]\\\'\"]/g, '\\$&')     //  Escape all quotes and special characters

        const TITLE = render_webpage(page.$("head title"))
            .trim()
            .replace(/[\u{0080}-\u{FFFF}]/gu, "")           //  Remove NON-ASCII Characters
            .replace(/[.*+?^${}()|[\]\\\'\"]/g, '\\$&')     //  Escape all quotes and special characters
            .slice(0, 64)

        const WORDS = BODY
            .split(' ')
            .map(word => {
                return word.replace(/[^\w\s\d]+/gi, ' ').toLowerCase().trim()
            }).filter(word => {
                return word.length > 0 && word.length < 32
            })

        const TEXT = WORDS.join()

        console.log(`[hunter] Got the body for "${TITLE}" (${PAGE_URL})`)

        pgClient.query(`INSERT INTO page VALUES ('${PAGE_URL}', '${TITLE}', '${TEXT}') ON CONFLICT(url) DO UPDATE SET title = '${TITLE}, body = ${TEXT}';`).then((result) => {
            console.log(`[hunter]  Paged "${TITLE}" (${PAGE_URL})`)

            new Set(WORDS).forEach(async (word) => {
                pgClient.query(`INSERT INTO word VALUES ('${word}', '${PAGE_URL}') ON CONFLICT(word, url) DO NOTHING;`).then((result) => {
                    // console.log(`[hunter] Processed PHASE 0 for ${PAGE_URL}`)
                })
            })
        })


        index.push(page)
    }
}).then(() => {
    index.sortIndex()

    let alpha = 0.85,
        epsilon = 0.000001

    matrix.loadFromIndex(index);
    var P = matrix.calculatePageRank(alpha, epsilon);

    var pages = index.getIndex(),
        rankedPages = [],
        roundingFactor = Math.round(1 / epsilon);

    for (var i = 0; i < pages.length; i++) {
        rankedPages.push({
            url: pages[i],
            pageRank: Math.max(Math.round(P[i] * roundingFactor) / roundingFactor, P[i])
        });
    }

    rankedPages = rankedPages.sort(function (a, b) {
        return b.pageRank - a.pageRank;
    });

    rankedPages.forEach(async (page) => {
        await pgClient.query(`INSERT INTO rank VALUES ('${page.url.trim()}', ${page.pageRank}) ON CONFLICT(url) DO UPDATE SET page_rank=${page.pageRank};`).then(result => {
            // console.info('[hunter] node-postgres: ' + result)
        }).catch(err => {
            console.error(`[hunter] node-postgres: ` + err)
        })
    })
}).finally(() => {
    console.log('[hunter]   Completed successfully')
})
