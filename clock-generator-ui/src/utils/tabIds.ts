/** What a tab says about the panel it opens, and the panel about its tab: `${prefix}-tab-${tab}`, `${prefix}-panel-${tab}` */
export function tabIds(prefix: string, tab: string) {
    return { tab: `${prefix}-tab-${tab}`, panel: `${prefix}-panel-${tab}` };
}

/** The props of a Tab that opens the panel of `tab` */
export function tabProps(prefix: string, tab: string) {
    const ids = tabIds(prefix, tab);
    return { id: ids.tab, 'aria-controls': ids.panel };
}
