// @ts-check

/**
 * @param {number} idx
 * @param {Uint8Array} buf
 */
function get(idx, buf) {
    if (!buf) {
        throw ReferenceError('buf cant be undefined or null');
    }
    if (idx >= buf.length || idx < 0) {
        throw RangeError(`index ${idx} is out of range`);
    }
    return buf[idx];
}

module.exports.get = get;
