import { Request, RequestInit, Response } from 'node-fetch'
import fetch from 'node-fetch'
import { URL } from 'url'
import { load, CheerioAPI } from 'cheerio'

export interface Page {
    url: URL
    text: string
    $: CheerioAPI
}

export interface CallbackOptions {
    callback: (response: Response) => void
}
export type FetchOptions = RequestInit & CallbackOptions  

export async function fetchPage(url: string | Request, init?: Partial<FetchOptions>): Promise<Page> {
    let response = await fetch(url, init);
    if(init && init.callback) {
        init.callback(response);
    }
    let contentType = response.headers.get("content-type") || "application/octet-stream";
    let index = contentType.indexOf(";");
    if(index != -1) {
        contentType = contentType.substring(0, index);
    }
    if("text/html" !== contentType) {
        throw new Error(`Content-Type is not text/html (=${contentType})`);
    }
    let text = await response.text();
    let $ = load(text);
    return {
        url: new URL(response.url),
        $,
        text,
    } as Page;
}

export class Session {
    public async fetch(url: string | Request, init?: Partial<FetchOptions>): Promise<Page> {
        let initObj = Object.assign({}, {
            headers: {},
            callback: (r: Response) => this.callback(r)
        }, init)
        
        let cookie: string | undefined = undefined;
        this.cookies.forEach((v,k) => {
            if(cookie) {
                cookie += "; " + encodeURIComponent(k) + "=" + encodeURIComponent(v);
            } else {
                cookie = encodeURIComponent(k) + "=" + encodeURIComponent(v);
            }
        });

        if(cookie) {
            (initObj.headers as any)["cookie"] = cookie;
        }

        return fetchPage(url, initObj)
    }

    private callback(response: Response): void {
        let setCookie: string | undefined = response.headers.get("set-cookie") as any;
        if(setCookie) {
            for(let ch of setCookie.split(",")) {
                let i = ch.indexOf(";");
                ch = ch.substring(0, i);
                let pair = ch.split("=");
                this.cookies.set(decodeURIComponent(pair[0].trim()), decodeURIComponent(pair[1]));
            }
        }
    }
    
    public cookies: Map<string, string> = new Map
}
