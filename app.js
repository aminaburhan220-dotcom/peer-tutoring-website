const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
require('dotenv').config();

const db = require('./database/db'); // also initializes schema
const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing & static files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions & flash messages
app.use(session({
  secret: process.env.SESSION_SECRET || 'peertutor-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));
app.use(flash());

// Make user, flash messages and site info available in every view
app.use(attachUser);
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.siteName = 'PeerTutor';
  res.locals.tagline = 'Learn Together. Grow Together.';
  next();
});

// Routes
app.use('/', require('./routes/main'));
app.use('/', require('./routes/auth'));
app.use('/student', require('./routes/student'));
app.use('/tutor', require('./routes/tutor'));
app.use('/admin', require('./routes/admin'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('404');
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, () => {
  console.log(`PeerTutor server running at http://localhost:${PORT}`);
});
