export class TerminalModel {
    #lines = [];
    #maxLines;
    #version = 0;
    #rawText = '';
    #truncatedCount = 0;

    constructor(maxLines = 10000) {
        this.#maxLines = maxLines;
    }

    replace(rawText) {
        if (rawText === this.#rawText) return false;
        this.#rawText = rawText;
        this.#lines = rawText.split('\n');
        if (this.#lines.length > this.#maxLines) {
            const drop = this.#lines.length - this.#maxLines;
            this.#lines = this.#lines.slice(drop);
            this.#truncatedCount += drop;
        }
        this.#version++;
        return true;
    }

    getLines(start, end) {
        return this.#lines.slice(start, end);
    }

    get lineCount() { return this.#lines.length; }
    get version() { return this.#version; }
    get truncatedCount() { return this.#truncatedCount; }
}
