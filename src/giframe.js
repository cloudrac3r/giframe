// @ts-check

const assert = require("assert").strict;
const {Decoder} = require("./decoder/decoder");
const {EventEmitter} = require("events");
// const ee = require("./utils/event.emitter");

const Stage = {
    'NONE': 'none',
    'INIT': 'init',
    'META': 'decode-meta',
    'DONE': 'done',
    'ALREADY': 'already-done',
};

/**
 * @typedef {number[]|string|import("./types").IFrameInfo} EmitData
 */
/**
 * @template Ret
 * @typedef IDeferred<Ret>
 * @prop {Promise<Ret>} promise
 * @prop {(data: Ret) => any} resolve
 * @prop {(..._: any[]) => any} reject
 */
/**
 * @typedef IReturn
 * @prop {number} width
 * @prop {number} height
 * @prop {Uint8Array} pixels
 */

class GIFrame extends EventEmitter {
    static event = Stage;

    stage = Stage.NONE;
    /** @type {Decoder?} */
    decoder = null;
    frameIdx = 0;
    /** @type {Uint8Array?} */
    buf = null;
    /** @type {number[]?} */
    pixels = null;
    isLocked = false;

    constructor(frameIdx = 0) {
        super();
        this.frameIdx = frameIdx;
        const deferred = {};
        let resolve, reject;
        /** @type {Promise<IReturn>} */
        const promise = new Promise((r, j) => {
            resolve = r;
            reject = j;
        });
        /** @type {IDeferred<IReturn>} */
        // @ts-ignore
        this.deferred = { promise, resolve, reject };
        assert(this.deferred.resolve);
        assert(this.deferred.reject);
    }

    /**
     * @param {Uint8Array} buf
     */
    concat(buf) {
        let buffer = buf;
        if (this.buf) {
            buffer = new Uint8Array(this.buf.length + buf.length);
            buffer.set(this.buf);
            buffer.set(buf, this.buf.length);
        }
        return buffer;
    }

    /**
     * @param {string} stage
     * @param {EmitData?} data
     */
    switchStage(stage, data = null) {
        this.stage = stage;
        this.emit(stage, data);
    }

    get bufferLength() {
        if (!this.buf) {
            return 0;
        }
        return this.buf.length;
    }

    lock() {
        this.isLocked = true;
    }

    unlock() {
        this.isLocked = false;
    }

    /**
     * @param {Uint8Array} appendedBuf
     */
    feed(appendedBuf) {
        if (this.isLocked) {
            return;
        }

        const buf = this.concat(appendedBuf);
        this.update(buf);
    }

    /**
     * @param {Uint8Array} buf
     */
    update(buf) {
        // the workflow is locked
        if (this.isLocked || Stage.ALREADY === this.stage) {
            return;
        }

        // already done, never update anymore
        if (Stage.DONE === this.stage) {
            this.switchStage(Stage.ALREADY, this.pixels);
            return;
        }

        // record origin buffer
        this.buf = buf;

        // init decoder
        if (Stage.NONE === this.stage) {
            this.decoder = new Decoder(buf);
            this.switchStage(Stage.INIT);

            // NOTE: does it necessary to handle the case that init stage incomplete?
            // try to enter next stage
            this.update(buf);
            return;
        }

        if (Stage.INIT === this.stage) {
            const decoder = this.decoder;
            assert(decoder);
            const finished = decoder.decodeMetaAndFrameInfo(buf, this.frameIdx);
            if (finished) {
                this.switchStage(Stage.META, decoder.getFrameInfo(this.frameIdx));
                // try to enter next stage
                this.update(buf);
            }
            return;
        }

        if (Stage.META === this.stage) {
            const decoder = this.decoder;
            assert(decoder);
            const pixels = decoder.decodeFrameRGBA(this.frameIdx, buf);
            if (pixels) {
                this.pixels = pixels;
                const { width, height } = decoder.getFrameInfo(this.frameIdx);
                this.deferred.resolve({width, height, pixels});
                this.switchStage(Stage.DONE, pixels);
                // try to enter next stage
                this.update(buf);
            }
            return;
        }

        const err = Error('unknown internal status: ' + this.stage);
        this.deferred.reject(err);
        throw err;
    }

    getFrame() {
        return this.deferred.promise;
    }
}

module.exports.GIFrame = GIFrame
