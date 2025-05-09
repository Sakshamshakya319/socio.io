const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create necessary directories
const directories = [
  'public',
  'public/css',
  'public/js',
  'public/images',
  'views',
  'views/layouts',
  'views/partials'
];

console.log('Creating directory structure...');
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dir}`);
  } else {
    console.log(`Directory already exists: ${dir}`);
  }
});

// Install dependencies
console.log('\nInstalling dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
  console.log('Dependencies installed successfully!');
} catch (error) {
  console.error('Error installing dependencies:', error.message);
}

// Build Tailwind CSS
console.log('\nBuilding Tailwind CSS...');
try {
  execSync('node build-css.js', { stdio: 'inherit' });
  console.log('Tailwind CSS built successfully!');
} catch (error) {
  console.error('Error building Tailwind CSS:', error.message);
}

console.log('\nSetup complete! You can now run the application with:');
console.log('npm run dev');