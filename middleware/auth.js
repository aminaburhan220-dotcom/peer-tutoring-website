function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function redirectIfAuthed(req, res, next) {
  if (req.session.user) {
    return res.redirect(`/${req.session.user.role}/dashboard`);
  }
  next();
}

module.exports = { attachUser, requireAuth, redirectIfAuthed };
