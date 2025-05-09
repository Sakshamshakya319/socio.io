const express = require('express');
const { engine } = require('express-handlebars');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const paymentRoutes = require('./routes/payments.routes');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up Handlebars as the view engine
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['x-rtb-fingerprint-id'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Serve static files - important for Vercel deployment
app.use(express.static(path.join(__dirname, 'public')));

// Trust proxy - important for Vercel
app.set('trust proxy', 1);

// API Routes
app.use('/api', paymentRoutes);

// Routes
app.get('/', (req, res) => {
  res.render('home', {
    title: 'Socio.Io: Intelligent Content Screening System',
    currentYear: new Date().getFullYear()
  });
});

app.get('/team', (req, res) => {
  const teamMembers = [
    {
      name: 'Lakshya Raj Singh Rathore',
      role: 'Project Supervisor',
      designation: 'Associate Professor, Department of Computer Applications',
      image: '',
      bio: 'Expert in Machine Learning and Content Analysis with 15+ years of academic and research experience.',
    },
    {
      name: 'Saksham Shakya',
      role: 'Frontend Developer',
      course: 'Bachelors in Computer Applications',
      image: '',
      bio: 'Some Knowledge in Web development and system architecture.',
    },
    {
      name: 'Antriksh Sharma',
      role: 'Backend Developer',
      course: 'Bachelors in Computer Applications',
      image: '',
      bio: 'Focused on content classification algorithms and model training.',
    },
    {
      name: 'Shubham Kumar',
      role: 'Report Genrating',
      course: 'Bachelors in Computer Applications',
      image: '',
      bio: 'Developing the user interface in reports with data.',
    },
    {
      name: 'Aadrika Varshney',
      role: 'Report Generating',
      course: 'Bachelors in Computer Applications',
      image: '',
      bio: 'Developing the user interface in reports with data.',
    }
  ];

  res.render('team', {
    title: 'Meet Our Team - Socio.Io',
    teamMembers,
    currentYear: new Date().getFullYear()
  });
});

app.get('/contact', (req, res) => {
  res.render('contact', {
    title: 'Contact Us - Socio.Io',
    currentYear: new Date().getFullYear()
  });
});

app.get('/download', (req, res) => {
  res.render('download', {
    title: 'Download Socio.Io',
    currentYear: new Date().getFullYear()
  });
});

// Handle contact form submission
app.post('/contact', (req, res) => {
  const { name, email, message } = req.body;
  
  // Here you would typically process the form data
  // For now, we'll just log it and redirect back to the contact page
  console.log('Form submitted:', { name, email, message });
  
  res.render('contact', {
    title: 'Contact Us - Socio.Io',
    currentYear: new Date().getFullYear(),
    success: 'Your message has been sent successfully!'
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    status: 404,
    message: 'Page Not Found',
    currentYear: new Date().getFullYear()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: '500 - Server Error',
    status: 500,
    message: 'Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : null,
    currentYear: new Date().getFullYear()
  });
});

// Start the server only if this file is run directly (not imported by index.js)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment  ${process.env.NODE_ENV || 'development'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Export the Express app for serverless environments
module.exports = app;