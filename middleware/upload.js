const path = require('path');
const multer = require('multer');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads', 'avatars'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const role = req.session.user ? req.session.user.role : 'user';
    const userId = req.session.user ? req.session.user.id : 'anon';
    cb(null, `${role}-${userId}-${Date.now()}${ext}`);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('Only JPG, PNG, or WEBP image files are allowed.'));
  }
  cb(null, true);
}

const avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Wraps multer so upload errors (bad file type, too large) show as a normal
// flash message and redirect, instead of crashing the request.
function handleAvatarUpload(req, res, next) {
  avatarUpload.single('avatar')(req, res, function (err) {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Image must be smaller than 2MB.'
        : (err.message || 'Could not upload image.');
      req.flash('error', message);
      return res.redirect(req.originalUrl);
    }
    next();
  });
}

module.exports = { handleAvatarUpload };
