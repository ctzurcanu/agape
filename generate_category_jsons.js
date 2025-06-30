
const fs = require('fs');
const path = require('path');

const DOCS_BASE_PATH = path.join(__dirname, 'docs');

function getSidebarLabelFromIndexMd(folderPath) {
    const indexPath = path.join(folderPath, 'index.md');
    if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
        const match = content.match(/sidebar_label:\s*"(.*?)"/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

function generateCategoryJsons() {
    if (!fs.existsSync(DOCS_BASE_PATH)) {
        console.error(`Docs base path not found: ${DOCS_BASE_PATH}`);
        return;
    }

    const folders = fs.readdirSync(DOCS_BASE_PATH, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    let position = 1;
    for (const folderName of folders) {
        const folderPath = path.join(DOCS_BASE_PATH, folderName);
        const categoryJsonPath = path.join(folderPath, '_category_.json');

        let label = getSidebarLabelFromIndexMd(folderPath);
        if (!label) {
            // Fallback to folder name if sidebar_label not found or index.md doesn't exist
            label = folderName;
        }

        const categoryJsonContent = JSON.stringify({
            position: position,
            label: label,
        }, null, 2);

        fs.writeFileSync(categoryJsonPath, categoryJsonContent);
        console.log(`Generated ${categoryJsonPath} with position ${position} and label "${label}"`);
        position++;
    }
    console.log('Finished generating _category_.json files.');
}

generateCategoryJsons();
