const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');

// Ensure the public/css directory exists
const cssDir = path.join(__dirname, 'public', 'css');
if (!fs.existsSync(cssDir)) {
  fs.mkdirSync(cssDir, { recursive: true });
}

// Create a basic CSS file with Tailwind directives
const cssContent = `
@tailwind base;
@tailwind components;
@tailwind utilities;
`;

// Process the CSS with Tailwind and write to file
async function buildCss() {
  const result = await postcss([
    tailwindcss,
    autoprefixer,
  ]).process(cssContent, {
    from: undefined,
    to: path.join(cssDir, 'tailwind.css'),
  });

  fs.writeFileSync(path.join(cssDir, 'tailwind.css'), result.css);
  console.log('Tailwind CSS built successfully!');
}

buildCss().catch(error => {
  console.error('Error building Tailwind CSS:', error);
});