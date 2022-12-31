import { default as express } from 'express'
import * as pg from 'pg'

const bodyParser = require('body-parser')
const PG_CLIENT = new pg.Client({
    database: 'hunterdb',
    user: 'k-54n7h05h',
    host: 'localhost',
    password: 'password',
    port: 5432,
})

PG_CLIENT.connect().then(() => {
    console.info('[page]    Connected to database')
}).catch((err) => {
    console.error('[page]    error: ', err.stack)
})

let application = express()

application.set('view engine', 'ejs')
application.use(bodyParser.urlencoded({ extended: true }))

function query(terms: Array<string>): string {
    return `SELECT p.url as url, p.title as title FROM page p INNER JOIN rank r ON p.url = r.url WHERE to_tsvector('english', body) @@ to_tsquery('english', '${terms.join(' & ')}') ORDER BY page_rank DESC;`
}

interface SearchResult {
    url: string,
    title: string
}

function get_urls(terms: Array<string> | undefined, callback?: (urls: Array<SearchResult>) => void): void {
    let results: SearchResult[] = []

    if (terms !== undefined && terms.length >= 1) {
        let result = PG_CLIENT.query(new pg.Query(query(terms)))

        result.on('row', (res) => {
            results.push({ url: res.url, title: res.title })
        })

        result.on('end', () => {
            if (callback !== undefined)
                callback(results)
        })

        result.on('error', (err) => {
            console.log('[page] pg error: ' + err.stack)
        })
    } else {
        console.error('[page] error: ' + terms?.length)
    }
}

application.get('/', (request, response) => {
    response.render('index')
})

application.get('/q', (request, response) => {
    let terms = request.query.search?.toString().trim().toLowerCase().split(' ')

    if (!terms || terms?.length <= 0)
        response.redirect('/')

    get_urls(terms, (result) => {
        response.render('query', {
            search: request.query.search,
            result: result
        })
    })
})

application.listen(4000, () => {
    console.info('[page]    Started successfully')
})
