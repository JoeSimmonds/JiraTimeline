// ==UserScript==
// @name         Jira Timeline
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Add a timeline visualisation to jira filters
// @author       You
// @match        https://jira.tools.tax.service.gov.uk/issues/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=service.gov.uk
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    addButton("Timeline", timeline)
})();

function addStyles() {
    const head = document.getElementsByTagName('head')[0]
    const style = upsertElement('tm_timeline_visualisation_styles', 'style')
    style.textContent = `
    div#tm_timeline_visualisation_container {
        height:95%;
        width:95%;
        position:absolute;
        left:2.5%;
        z-index:100;
        top:2.5%;
        overflow:auto;
    }

    svg#tm_timeline_visualisation {
        border:1px solid black;
        background-color: #181808f8;
    }

    svg#tm_timeline_visualisation .bar, svg#tm_timeline_visualisation text {
        stroke:#666666;
        stroke-width:1px;
        paint-order: stroke;
    }

    svg#tm_timeline_visualisation .bar {fill:red;}
    svg#tm_timeline_visualisation .status-bar-inprogress {fill:blue;}
    svg#tm_timeline_visualisation .status-bar-done {fill:green;}
    svg#tm_timeline_visualisation .status-bar-todo {fill:gray;}

    svg#tm_timeline_visualisation text {fill:#eeeeee; font-size:6px;}


    svg#tm_timeline_visualisation .now-line {stroke-width:1px; stroke:green;}

    svg#tm_timeline_visualisation line.month-line {stroke-width:0.2px; stroke:#666666ff;}
    svg#tm_timeline_visualisation rect.month-line {stroke-width:0.2px; fill:#666666ff;}
    svg#tm_timeline_visualisation text.month-line {fill:#cccccc;font-size:6px}

    svg#tm_timeline_visualisation .week-line {stroke-width:0.1px; stroke:#99999966;}
    `
    head.appendChild(style);
}

function timeline() {
    addStyles()
    const rsvg = buildSvg()

    const p = getIssuesFromApi()

    p.then(issues => {
        let idx =0
        const now = new Date()
        let lowest = now
        let highest = new Date(0)
        for (const i of issues) {
            if (i.startDate < lowest) lowest = i.startDate
            if (i.endDate > highest) highest = i.endDate
        }

        const vbleft = Math.floor(daysBetween(now, lowest)) -10
        const vbTop = 0 -10
        const vbWidth = Math.max(100, Math.floor(daysBetween(lowest, highest))) +20
        const vbHeight = Math.max(100, Math.floor(issues.length * 15)) +20

        rsvg.setViewBox(vbleft, vbTop, vbWidth, vbHeight)

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

        for (const d = lowest; d < highest; d.setDate(d.getDate() + 1)) {
            if (d.getUTCDate() === 1) {
                rsvg.addTimePoint(daysBetween(now, d), "month-line", monthNames[d.getUTCMonth()])
            } else if (d.getUTCDay() === 1) {
                rsvg.addTimePoint(daysBetween(now, d), "week-line")
            }
        }

        for (const i of issues) {
            rsvg.addBar(idx, daysBetween(now, i.startDate), i.elapsedDays(), i.label(),getStatusClass(i.status))
            idx++
        }

        rsvg.addTimePoint(0, "now-line")

        forceRedrawOfChildren(rsvg.svg.parentNode)
    })
}

function getStatusClass(status)
{
    switch(status) {
        case 'Done':
            return 'status-bar-done'
        case 'In Progress':
            return 'status-bar-inprogress';
        case 'To Do':
            return 'status-bar-todo';
        default:
            return 'bar'
    }
}

function buildSvg() {
    const ctr = upsertElement('tm_timeline_visualisation_container', 'div')
    const svg = upsertElement('tm_timeline_visualisation', 'svg', 'http://www.w3.org/2000/svg')
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')
    ctr.appendChild(svg)
    ctr.addEventListener("click", function() {ctr.remove();})

    const hdr = document.getElementById('header')
    hdr.parentNode.insertBefore(ctr, hdr)
    return new RichSvg(svg)
}

function getIssuesFromApi() {
    const apiUrl = 'https://jira.tools.tax.service.gov.uk/rest/api/latest/search'
    const params = new Proxy(new URLSearchParams(window.location.search), {
        get: (searchParams, prop) => searchParams.get(prop),
    });
    const data = {
        jql: params.jql,
        maxResults:250,
        fields: [
            "key",
            "summary",
            "customfield_11104", // start date
            "duedate", // due date
            "status"
        ]
    }

    const headers = new Headers();
    headers.append("Content-Type", "application/json");

    var requestOptions = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data),
    };

    return fetch(apiUrl, requestOptions)
        .then(response => response.json())
        .then(js => {console.log(js);return js})
        .then(json => {return json.issues.map(i => {
            return new Issue(i.key,
                      parseDateFromApi(i.fields.customfield_11104, '-'),
                      parseDateFromApi(i.fields.duedate, '-'),
                      i.fields.summary,
                      i.fields.status.statusCategory.name)})})
}

function getTextFromColumn(row, fieldName) {
    return row.getElementsByClassName(fieldName)[0].innerText
}

function parseDateFromApi(str) {
    const parts = str.split('-').map(x => parseInt(x))
    let year = parts[0]
    if (year < 100) year = year + 2000
    return new Date(Date.UTC(year, parts[1]-1, parts[2]))
}

class Issue{
    constructor(issueKey, startDate, endDate, summary, status) {
        this.issueKey = issueKey
        this.startDate = startDate
        this.endDate = endDate
        this.summary = summary
        this.status = status
    }

    asString() {
        return `${this.issueKey} from ${this.startDate.toUTCString()} to from ${this.startDate.toUTCString()} (${this.elapsedDays()} days)`
    }

    label() {
        return this.issueKey + " " + this.summary
    }

    elapsedDays() {
        return daysBetween(this.startDate, this.endDate)
    }
}

function daysBetween(d1, d2) {
    const t1 = d1.valueOf()
    const t2 = d2.valueOf()
    const millisBetween = t2 - t1
    const millisInDay = 1000 * 60 * 60 * 24
    return millisBetween / millisInDay
}

class RichSvg {
    constructor(svg) {
        this.svg = svg
    }

    setViewBox(left, top, width, height) {
        this.viewBox = {
            left: left,
            top: top,
            width: width,
            height: height
        }
        const vbAttr = `${left} ${top} ${width} ${height}`
        this.svg.setAttribute('viewBox', vbAttr)
    }

    addBar(index, start, length, text, clazz='bar') {
        if (length <= 0) {
            this.addCircle(start, index*15+7, 3).classList.add(clazz)
        } else {
            this.addRect(start, index*15, length, 14).classList.add(clazz)
        }
        this.addText(start+2, index*15 + 9, text)
    }

    addTimePoint(when, clazz, label) {
        this.addVerticalLine(when, this.viewBox.top, this.viewBox.height - this.viewBox.top).classList.add(clazz)
        if(label) {
            this.addRect(when -10, this.viewBox.top+3, 20, 8, 2).classList.add(clazz)
            this.addText(when -7, this.viewBox.top+9, label).classList.add(clazz)
        }
    }

    addVerticalLine(x, top, bottom) {
        const l = document.createElement('line')
        l.setAttribute('x1', x)
        l.setAttribute('y1', top)
        l.setAttribute('x2', x)
        l.setAttribute('y2', bottom)
        this.svg.appendChild(l)
        return l
    }

    addText(left, top, text) {
        const t = document.createElement('text')
        t.setAttribute('x', left)
        t.setAttribute('y', top)
        t.innerText = text
        this.svg.appendChild(t)
        return t
    }

    addCircle(x, y, radius) {
        const c = document.createElement('circle')
        c.setAttribute('cx', x)
        c.setAttribute('cy', y)
        c.setAttribute('r', radius)
        this.svg.appendChild(c)
        return c
    }

    addRect(left, top, width, height, cornerRadius) {
        const r = document.createElement('rect')
        r.setAttribute('x', left)
        r.setAttribute('y', top)
        r.setAttribute('width', width)
        r.setAttribute('height', height)
        if (cornerRadius) {
            r.setAttribute('rx', cornerRadius)
            r.setAttribute('ry', cornerRadius)
        }
        this.svg.appendChild(r)
        return r
    }
}

function upsertElement(id, elementType, ns) {
    let el = document.getElementById(id)
    if(!el) {
        if (ns) {
            el = document.createElementNS(ns, elementType)
        } else {
            el = document.createElement(elementType)
        }
        el.setAttribute('id', id)
    }
    return el
}

function addButton(text, f) {
    const btn = document.createElement('button')
    btn.innerText = text
    const nav = document.getElementsByClassName('aui-nav')[0]
    const li = document.createElement('li')
    li.appendChild(btn)
    nav.appendChild(li)
    btn.addEventListener("click", f)
}

function forceRedrawOfChildren(element){
    if (!element) { return; }

    const x = element.innerHTML
    element.innerHTML = ""
    element.innerHTML = x
}
