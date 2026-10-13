const puppeteer = require(require.resolve('puppeteer-core', { paths: ['C:/Users/User/.gemini/antigravity/brain/c26af5ae-d3fd-4ec7-8863-cfb7ac7fa65f/scratch/node_modules'] }));
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = 'C:/Users/User/Desktop/SHI';
const PORT = 8099;
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    const filePath = path.join(ROOT_DIR, reqPath);
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.statusCode = 404;
            return res.end('Not found: ' + reqPath);
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}...`);
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        const consoleErrors = [];
        page.on('pageerror', err => consoleErrors.push(err.message));

        await page.goto(`http://localhost:${PORT}/experiments/evaluation.html`, { waitUntil: 'networkidle0' });

        // 1. Check title & headers
        const title = await page.title();
        console.log(`Page title: ${title}`);
        assert(title.includes('Експертне оцінювання'), 'Title must match expected');

        // 2. Check rendered scenario and item
        const state = await page.evaluate(() => {
            const scBadge = document.getElementById('sc-badge')?.textContent;
            const scName = document.getElementById('sc-name')?.textContent;
            const itemTitle = document.querySelector('.item-title')?.textContent;
            const gradeBtns = document.querySelectorAll('.grade-btn');
            return {
                scBadge,
                scName,
                itemTitle,
                gradeBtnsCount: gradeBtns.length
            };
        });

        console.log('UI Initial State:', state);
        assert(state.scBadge.includes('Сценарій 1'), 'Scenario 1 badge must be visible');
        assert.strictEqual(state.gradeBtnsCount, 3, 'Must render 3 grade buttons (0, 1, 2)');

        // 3. Click grade 2 button
        await page.click('.grade-btn.btn-2');
        await new Promise(r => setTimeout(r, 200));

        // 4. Verify saved grade in localStorage
        const savedStorage = await page.evaluate(() => {
            return localStorage.getItem('thesis_blind_evaluations_v1');
        });
        console.log(`localStorage after grading: ${savedStorage}`);
        assert(savedStorage && savedStorage.includes('2'), 'Evaluation grade 2 must be persisted');

        // 5. Test JSON and CSV generation in page context
        const exportTest = await page.evaluate(() => {
            const jsonStr = (function() {
                const arr = [];
                DATASET.forEach(sc => {
                    sc.items.forEach(it => {
                        if (evaluations[it.evaluation_id] !== undefined) {
                            arr.push({ evaluation_id: it.evaluation_id, grade: evaluations[it.evaluation_id] });
                        }
                    });
                });
                return arr;
            })();
            return {
                exportedCount: jsonStr.length,
                firstItem: jsonStr[0]
            };
        });
        console.log('Export evaluation test:', exportTest);
        assert.strictEqual(exportTest.exportedCount, 1, '1 item graded and exported');

        // 6. Verify zero console errors
        console.log(`Console errors count: ${consoleErrors.length}`);
        assert.strictEqual(consoleErrors.length, 0, 'Must have 0 uncaught errors in browser');

        console.log('✅ ALL EVALUATION UI BROWSER TESTS PASSED!');
    } catch(err) {
        console.error('Browser test failure:', err);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
    }
});
