const db = require('../database/db');

// A user's dashboard access is based on which profile rows actually exist for
// them (students / tutors), not a single exclusive "role" — because on this
// platform a student can ALSO be a peer tutor on the same account at the same
// time. Admin stays a strictly separate, exclusive role.
function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }

    if (role === 'admin' || req.session.user.role === 'admin') {
      if (req.session.user.role !== role) {
        req.flash('error', 'You do not have permission to access that page.');
        return res.redirect(`/${req.session.user.role}/dashboard`);
      }
      return next();
    }

    const hasProfile = role === 'student'
      ? db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.session.user.id)
      : db.prepare('SELECT id FROM tutors WHERE user_id = ?').get(req.session.user.id);

    if (!hasProfile) {
      req.flash('error', role === 'tutor'
        ? "You don't have a peer tutor profile yet. You can become one from your Student Dashboard."
        : 'You do not have permission to access that page.');
      return res.redirect(`/${req.session.user.role}/dashboard`);
    }
    next();
  };
}

module.exports = { requireRole };
