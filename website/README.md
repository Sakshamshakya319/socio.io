# Socio.io Website

A Node.js website with Handlebars templating for the Socio.io content screening system.

## Features

- Responsive design using Tailwind CSS
- Server-side rendering with Handlebars
- Contact form functionality
- Download page for the Socio.io extension

## Installation

1. Make sure you have Node.js installed (v14 or higher recommended)
2. Clone this repository
3. Navigate to the project directory
4. Run the setup script:

```bash
npm run setup
```

This will:
- Create the necessary directory structure
- Install all dependencies
- Build the Tailwind CSS

Alternatively, you can manually install dependencies:

```bash
npm install
```

## Running the Application

To start the development server:

```bash
npm run dev
```

This will start the application on http://localhost:3000

To start the production server:

```bash
npm start
```

## Deploying to Vercel

This project is configured for easy deployment to Vercel.

### Prerequisites

1. Create a Vercel account at [vercel.com](https://vercel.com)
2. Install the Vercel CLI (optional for GitHub deployments):
   ```bash
   npm install -g vercel
   ```

### Option 1: Deploy from GitHub

1. Push your code to a GitHub repository
2. Log in to your Vercel account
3. Click "New Project" and import your GitHub repository
4. Configure the project:
   - Framework Preset: Other
   - Root Directory: ./
   - Build Command: npm run build
   - Output Directory: ./
   - Install Command: npm install
5. Add Environment Variables:
   - RAZORPAY_KEY_ID
   - RAZORPAY_KEY_SECRET
6. Click "Deploy"

### Option 2: Deploy using Vercel CLI

1. Login to Vercel:
   ```bash
   vercel login
   ```
2. Deploy the project:
   ```bash
   vercel
   ```
3. Follow the prompts to configure your project
4. For production deployment:
   ```bash
   vercel --prod
   ```

## Building CSS

The application uses Tailwind CSS. To rebuild the CSS:

```bash
npm run build-css
```

This will be automatically run after `npm install` as well.

## Project Structure

- `app.js` - Main application file
- `views/` - Handlebars templates
  - `layouts/` - Layout templates
  - `partials/` - Reusable template parts
- `public/` - Static assets
  - `css/` - Stylesheets
  - `js/` - JavaScript files
  - `images/` - Image assets

## License

See the LICENSE file for details.