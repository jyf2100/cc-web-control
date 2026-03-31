export class FontScaler {
    constructor(container) {}
    selectSize(totalLines, viewportHeight) {
        return { fontSize: 13, lineHeight: 19.5, lineCount: totalLines };
    }
}
