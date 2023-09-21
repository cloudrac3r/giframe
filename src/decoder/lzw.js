// @ts-check

const {get} = require("../utils/proxy");

/**
 * @param {Uint8Array} buf
 * @param {number} p
 * @param {number} outputLen
 */
function unpackLZW(buf, p, outputLen) {
    /** @type {string | undefined} */
    let msg = undefined;
    let ok = true;
    const output = new Uint8Array(outputLen);
    const minCodeSize = get(p++, buf);

    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let nextCode = eoiCode + 1;

    let curCodeSize = minCodeSize + 1;
    let codeMask = (1 << curCodeSize) - 1;
    let curShift = 0;
    let cur = 0;
    let op = 0;
    let subBlockSize = get(p++, buf);
    const codeTable = new Int32Array(4096);
    /** @type {number?} */
    let prevCode = null;

    while (true) {
        while (curShift < 16) {
            if (subBlockSize === 0) {
                break;
            }

            cur |= get(p++, buf) << curShift;
            curShift += 8;

            if (subBlockSize === 1) {
                subBlockSize = get(p++, buf);
            }
            else {
                --subBlockSize;
            }
        }

        if (curShift < curCodeSize) {
            break;
        }

        const code = cur & codeMask;
        cur >>= curCodeSize;
        curShift -= curCodeSize;

        if (code === clearCode) {
            nextCode = eoiCode + 1;
            curCodeSize = minCodeSize + 1;
            codeMask = (1 << curCodeSize) - 1;

            prevCode = null;
            continue;
        }
        else if (code === eoiCode) {
            break;
        }

        /** @type {number} */
        // @ts-ignore
        const chaseCode = code < nextCode ? code : prevCode;

        let chaseLen = 0;
        let chase = chaseCode;
        while (chase > clearCode) {
            chase = codeTable[chase] >> 8;
            ++chaseLen;
        }

        const k = chase;

        const opEnd = op + chaseLen + (chaseCode !== code ? 1 : 0);
        if (opEnd > outputLen) {
            ok = false;
            msg = 'Warning, gif stream longer than expected.';
            return { output, ok, msg};
        }

        output[op++] = k;

        op += chaseLen;
        let b = op;

        if (chaseCode !== code) {
            output[op++] = k;
        }

        chase = chaseCode;
        while (chaseLen--) {
            chase = codeTable[chase];
            output[--b] = chase & 0xff;
            chase >>= 8;
        }

        if (prevCode !== null && nextCode < 4096) {
            codeTable[nextCode++] = prevCode << 8 | k;
            if (nextCode >= codeMask + 1 && curCodeSize < 12) {
                ++curCodeSize;
                codeMask = codeMask << 1 | 1;
            }
        }

        prevCode = code;
    }

    if (op !== outputLen) {
        ok = false;
        msg = 'Warning, gif stream shorter than expected.';
    }

    return { output, ok, msg };
}

module.exports.unpackLZW = unpackLZW
