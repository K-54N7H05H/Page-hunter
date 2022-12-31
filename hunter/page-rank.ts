import * as cheerio from 'cheerio'
import { IncomingMessage } from 'http'
import * as url from 'url'
import { Page } from './fetch'

export class PagerankLinkIndexer {

    static parseOutboundLinks(page: Page): Array<string> {
        let pageURL: string = page.url.toString()
        let $ = page.$

        return $('a[href]')
            .get()
            .map((node) => {
                var href = $(node).attr('href') || ''
                return url.resolve(pageURL, href)
            })
            .filter((resolvedURL) => {
                if (resolvedURL === pageURL) return false;
                if (!/^https?:\/\//i.test(resolvedURL)) return false;
                return true;
            })
    }

    public push(page: Page): void {
        let url: string = page.url.toString()
        if (this.index.indexOf(url) > -1)
            throw 'Provided document of url <' + url + '> has already been indexed'
        else {
            this.index.push(url)
            this.map.set(url, PagerankLinkIndexer.parseOutboundLinks(page))
        }
    }

    public sortIndex(): void {
        this.index = this.getSortedIndex()
    }

    public get(url: string): Array<string> {
        return this.map.get(url) || []
    }

    public getAll(): Map<string, Array<string>> {
        return this.map
    }

    public getIndex(): Array<string> {
        return this.index
    }

    public getSortedIndex(): Array<string> {
        return this.index.sort()
    }

    public hasOutlink(url: string, outlink: string): boolean {
        return (this.get(url).indexOf(outlink) > -1)
    }

    public getOutlinksCount(url: string): number {
        return this.get(url).length
    }

    private index: Array<string> = []
    private map: Map<string, Array<string>> = new Map()
}

export class PagerankMatrix {

    private static sum(values: Array<number>): number {
        return values.reduce((sum, current) => {
            return sum + current
        })
    }

    private static difference(lhs: Array<number>, rhs: Array<number>): number {
        let difference: number = 0

        for (var i = 0; i < lhs.length; ++i)
            difference += Math.abs(lhs[i] - rhs[i])

        return difference
    }

    private static applyGoogleTransform(G: Array<Array<number>>, alpha: number) {
        let matrix: Array<Array<number>> = []
        let length: number = G.length

        var adjustment: number = ((1 - alpha) / length)

        for (let row = 0; row < length; ++row) {
            matrix[row] = []
            for (let col = 0; col < length; ++col)
                matrix[row][col] = alpha * G[row][col] + adjustment
        }

        return matrix
    }

    public loadFromIndex(indexer: PagerankLinkIndexer): PagerankMatrix {
        let index = indexer.getIndex()
        let index_length = index.length
        let matrix: Array<Array<number>> = []

        var row = 0, col = 0, x = '', y = ''
        for (row = 0; row < index_length; ++row) {
            matrix[row] = []
            for (col = 0; col < index_length; ++col) {
                x = index[row]
                y = index[col]

                if (row == col || !indexer.hasOutlink(x, y))
                    matrix[row][col] = 0
                else {
                    matrix[row][col] = 1 / indexer.getOutlinksCount(x)
                }

            }

            if (PagerankMatrix.sum(matrix[row]) == 0) {
                matrix[row].fill(1 / index_length)
            }
        }


        this.matrix = matrix

        return this
    }

    public calculatePageRank(alpha: number, epsilon: number) {
        var G: Array<Array<number>> = PagerankMatrix.applyGoogleTransform(this.matrix, alpha)
        var length = this.matrix.length

        var P: Array<number> = [], previousP: Array<number> = []

        P.length = length
        P.fill(1 / length)

        var error = 1, pr = 0
        while (error >= epsilon) {
            previousP = P.slice()

            for (let i = 0; i < length; ++i) {
                pr = 0;
                for (let j = 0; j < length; ++j)
                    pr += P[j] * G[j][i]

                P[i] = pr
            }

            error = PagerankMatrix.difference(P, previousP)
        }

        return P
    }

    public asArray(): Array<Array<number>> {
        return this.matrix
    }

    private matrix: Array<Array<number>> = []
}
