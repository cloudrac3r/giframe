import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs-extra';
import path from 'path';
import {GIFrame} from '../src/giframe';
import { PNG } from 'pngjs';
import { writeTempImage, diffImage, cleanTempDir } from './utils';

const GIF_PATH = path.resolve(__dirname, 'img', '1.gif');
const LARGE_GIF_PATH = path.resolve(__dirname, 'img', '3.gif');

function createBase64(pixels, obj): string {
    const width = obj.width;
    const height = obj.height;
    let png = new PNG({
		width,
		height,
		bitDepth: 8, // 8 red + 8 green + 8 blue + 8 alpha
		colorType: 6, // RGBA
		inputColorType: 6, // RGBA
		inputHasAlpha: true,
	});
    png.data = Buffer.from(pixels);
    let buffer = PNG.sync.write(png);
    return buffer.toString("base64");
}

describe('Giframe', function () {

    this.timeout(2000);

    it('should return 0 with no buffer', () => {
        const giframe = new GIFrame();
        expect(giframe.bufferLength).to.be.equal(0);
    });

    it('should return buffer length which equals to feeded length', () => {
        const buf = fs.readFileSync(GIF_PATH);
        const giframe = new GIFrame();

        giframe.feed(buf.slice(0, 50));
        expect(giframe.bufferLength).to.be.equal(50);

        giframe.feed(buf.slice(50, 72));
        expect(giframe.bufferLength).to.be.equal(72);
    });

    it('should create valid base64 by pixels', () => {
        const base64: string = createBase64([
            32, 223, 0, 255,
            255, 0, 0, 255,
            32, 223, 0, 255,
            255, 0, 0, 255
        ], { width: 2, height: 2, usePNG: true });

        expect(base64).to.be.equal('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4AWNUuM/w/74iAwMTAxQAACsXAwIcSfeYAAAAAElFTkSuQmCC');
    });

    it('should throw an error when stage is changed outside unintendedly', done => {
        const giframe = new GIFrame();
        (giframe as any).stage = 'mess';
        const feed = () => giframe.feed(fs.readFileSync(GIF_PATH));
        expect(feed).to.be.throw('unknown internal status: mess');

        giframe.getFrame()
            .then(() => expect.fail('promise should be rejected'))
            .catch((err: Error) => {
                expect(err.message).to.be.equal('unknown internal status: mess');
                done();
            });
    });

    describe('Image generated', () => {

        it('should automatically enter next stage when feeded enough bytes', async () => {
            const giframe = new GIFrame();
            console.error(GIF_PATH)
            giframe.feed(fs.readFileSync(GIF_PATH));
            expect((await giframe.getFrame()).pixels[0]).to.be.a('number');
        });

        it('should generate a correct first-frame image', async () => {
            const giframe = new GIFrame(0);
            giframe.feed(fs.readFileSync(GIF_PATH));
            const frame = await giframe.getFrame();
            const base64 = createBase64(frame.pixels, frame)
            const outputPath = await writeTempImage(base64);
            const diff = await diffImage(path.resolve(__dirname, 'img', '1-1.png'), outputPath, 0.1);
            expect(diff).to.be.equal(0);
        });

        it('should generate a correct second-frame image', async () => {
            const giframe = new GIFrame(1);
            giframe.feed(fs.readFileSync(GIF_PATH));
            const frame = await giframe.getFrame();
            const base64 = createBase64(frame.pixels, frame);
            const outputPath = await writeTempImage(base64);
            const diff = await diffImage(path.resolve(__dirname, 'img', '1-2.png'), outputPath, 0.1);
            expect(diff).to.be.equal(0);
        });

        it('should work well on a more real GIF when integrated with stream APIs', async () => {
            const totalLen: number = fs.readFileSync(LARGE_GIF_PATH).length;
            const stream: fs.ReadStream = fs.createReadStream(LARGE_GIF_PATH, {
                highWaterMark: 1024 * 20
            });

            const giframe = new GIFrame(0);
            giframe.on(GIFrame.event.DONE, () => stream.close());
            stream.on('data', chunk => {
                // @ts-ignore
                giframe.feed(chunk);
            });

            const frame = await giframe.getFrame();
            const base64 = createBase64(frame.pixels, frame);
            const outputPath = await writeTempImage(base64);
            const diff = await diffImage(path.resolve(__dirname, 'img', '3.png'), outputPath);
            expect(diff).to.be.equal(0);
            expect(giframe.bufferLength, 'must not use all bytes to decode').to.be.lessThan(totalLen);

        });

        after(() => cleanTempDir());
    });

    describe('Workflow', () => {
        let buf: Buffer;
        let giframe: GIFrame;
        let listeners: Array<sinon.SinonSpy<any[], any[]>>;

        function check(expects: Array<boolean>) {
            const names: Array<string> = ['init', 'meta', 'done', 'already'];
            const called = listeners.map(l => l.calledOnce);
            expect(called, "called events").to.be.deep.equal(expects);
        }

        beforeEach(async () => {
            buf = fs.readFileSync(GIF_PATH);
            giframe = new GIFrame(0);

            listeners = [
                sinon.spy(),
                sinon.spy(),
                sinon.spy(),
                sinon.spy()
            ];
            giframe.on(GIFrame.event.INIT, listeners[0]);
            giframe.on(GIFrame.event.META, listeners[1]);
            giframe.on(GIFrame.event.DONE, listeners[2]);
            giframe.on(GIFrame.event.ALREADY, listeners[3]);
        });

        it('should throw an error when the very first chunk is shorter than needed', () => {
            const feed = () => giframe.feed(buf.slice(0, 20));
            expect(feed).to.be.throw(/out of range/i);
        });

        it('should only trigger \'INIT\' event', () => {
            giframe.feed(buf.slice(0, 50));

            check([true, false, false, false]);
        });

        it('should trigger all events except \'ALREADY\'', () => {
            giframe.feed(buf.slice(0, 50));
            giframe.feed(buf.slice(50, 85));

            check([true, true, true, true]);
        });

        it('should trigger all events', () => {
            giframe.feed(buf.slice(0, 50));
            giframe.feed(buf.slice(50, 85));
            giframe.feed(buf.slice(85, 100));

            check([true, true, true, true]);
        });

        it('should only trigger \'INIT\', \'META\' event after locked', () => {
            giframe.on(GIFrame.event.META, () => giframe.lock())
            giframe.feed(buf);

            check([true, true, false, false]);
        });

        it('should trigger \'PIXEL\', \'DONE\' event only when unlocked', done => {
            giframe.on(GIFrame.event.META, () => {
                giframe.lock();

                process.nextTick(() => {
                    giframe.unlock();
                    giframe.feed(new Uint8Array(0));
                    check([true, true, true, true]);
                    done();
                });
            });

            giframe.feed(buf);
            check([true, true, false, false]);
        });

        it('should not process when locked', () => {
            giframe.feed(buf.slice(0, 50));
            check([true, false, false, false]);

            giframe.lock();
            giframe.feed(buf.slice(50, 100));
            check([true, false, false, false]);
            expect(giframe.bufferLength).to.be.equal(50);
        });

        it('should not process when stage is already', () => {
            giframe.feed(buf);
            giframe.feed(buf);
            check([true, true, true, true]);
            expect(() => giframe.feed(buf)).not.to.throw();
        });
    });
});
