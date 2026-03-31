export class PretextMeasurer {
    measureHeight(text, font, width, lineHeight, options) {
        return { height: lineHeight, lineCount: 1 };
    }
    clearCache() {}
    get available() { return false; }
}
