# PeerTutor

**Learn Together. Grow Together.**

A full-stack peer tutoring platform built with **Node.js, Express, EJS, vanilla JavaScript, and SQLite** (no frontend frameworks, no CSS frameworks).

Students can browse tutors by subject, book sessions, message tutors, and leave reviews. Tutors manage their profile, availability, and bookings. Admins approve tutors, manage the platform, and view reports.

---

## 1. Requirements

- [Node.js](https://nodejs.org) v18 or newer (v22 recommended)
- npm (comes with Node.js)

No external database server is needed — PeerTutor uses a local SQLite file that's created automatically.

---

## 2. Installation

From the `PeerTutor` folder, run:

```bash
npm install
```

This installs: `express`, `ejs`, `express-session`, `better-sqlite3`, `bcryptjs`, `connect-flash`, `dotenv`.

> `better-sqlite3` compiles a small native module during install. If install fails on your machine, make sure you have build tools available (on Windows: `npm install --global windows-build-tools` in an elevated prompt; on macOS: Xcode Command Line Tools `xcode-select --install`; on Linux: `build-essential` and `python3`).

---

## 3. Set up and seed the database

The database schema is created automatically the first time the server starts. To populate it with sample subjects, tutors, students, bookings and reviews, run:

```bash
npm run seed
```

This creates `database/peertutor.sqlite` with demo data. Running it again is safe — it skips seeding if the database already has users.

To start completely fresh, delete `database/peertutor.sqlite` and run `npm run seed` again.

---

## 4. Start the server

```bash
npm start
```

You should see:

```
PeerTutor server running at http://localhost:3000
```

## 5. Open the website

Visit **http://localhost:3000** in your browser.

---

## 6. Test login credentials

| Role    | Email                | Password    |
|---------|-----------------------|-------------|
| Admin   | admin@peertutor.com   | Admin123!   |
| Student | sara@student.com      | Student123! |
| Tutor   | david@tutor.com       | Tutor123!   |

(A second demo tutor, `omar@tutor.com` / `Tutor123!`, is seeded with a **pending** approval status so you can test the admin approval flow.)

---

## 7. Project structure

```
PeerTutor/
├── app.js                  # Express app entry point
├── package.json
├── database/
│   ├── db.js                # SQLite connection (better-sqlite3)
│   ├── schema.sql            # Table definitions
│   └── seed.js                # Sample data
├── middleware/
│   ├── auth.js               # Session/auth helpers
│   └── role.js                # Role-based route protection
├── routes/
│   ├── main.js                # Public pages (home, subjects, find tutors, tutor profile...)
│   ├── auth.js                 # Register / login / logout / forgot password
│   ├── student.js               # Student dashboard & actions
│   ├── tutor.js                  # Tutor dashboard & actions
│   └── admin.js                   # Admin panel & actions
├── views/
│   ├── *.ejs                       # Public pages
│   ├── student/ tutor/ admin/       # Role-specific dashboard views
│   └── partials/                     # Shared navbar, footer, sidebars, toasts
└── public/
    ├── css/style.css                 # All styling (two-color design system)
    ├── js/main.js                     # Vanilla JS: nav, filters, validation, charts, chat
    ├── images/                         # Default avatar
    └── uploads/                         # Reserved for future file uploads
```

---

## 8. What's implemented

- **Public pages**: Home, About, How It Works, Subjects, Find Tutors (search/filter/sort), Tutor Profile, Contact, FAQ, Login, Register, Forgot Password, 404.
- **Auth**: registration (student/tutor), login, logout, hashed passwords (bcrypt), session-based auth, role-based route protection (a student can't open `/tutor/...` or `/admin/...` routes, etc.).
- **Student dashboard**: overview stats, profile editing, booking sessions, viewing/cancelling bookings, session history, favorites, leaving reviews, messaging tutors, notifications, password change.
- **Tutor dashboard**: overview stats, profile editing, subject selection, availability management, accepting/rejecting booking requests, marking sessions complete, viewing reviews, earnings estimate, messaging students, notifications, password change.
- **Admin panel**: platform stats with charts, manage students (search/edit/activate/deactivate/delete), manage tutors (approve/reject/edit/activate/deactivate/delete), manage subjects (add/delete), manage bookings (filter/update status), manage reviews (view/delete), messages overview, reports with vanilla-JS canvas charts.
- **Database**: SQLite with `users`, `students`, `tutors`, `subjects`, `tutor_subjects`, `bookings`, `availability`, `messages`, `notifications`, `reviews`, `favorites` — all foreign-keyed appropriately, with `ON DELETE CASCADE` where relevant.
- **Vanilla JS**: mobile nav, dashboard sidebar toggle, password show/hide, FAQ accordion, toast auto-dismiss, delete confirmations, star-rating input, client-side form validation, and a small canvas bar-chart renderer for the admin reports.

## 9. Gender field & profile photos

- **Registration** now includes a required Gender field (Female / Male). It sets a default profile avatar matching the selected gender (`/images/avatar-female.svg` or `/images/avatar-male.svg`) — never random.
- **Uploading a real photo** (from the Student or Tutor "My Profile" page) always overrides the gender-based default. Uploads are validated (JPG/PNG/WEBP only, 2MB max) and stored in `public/uploads/avatars/`.
- The `avatar` field is shared across the whole app (dashboard, tutor search, tutor profile, messages, bookings, reviews), so once it's set correctly it's automatically correct everywhere — no per-page logic needed.
- Existing databases upgrade automatically: `database/db.js` adds the `gender` column via `ALTER TABLE` if it's missing, so re-running the app never breaks an install that was seeded before this feature existed.
- Demo accounts (from `npm run seed`) use real headshot-style photos (cropped from the site's own hero photo) instead of the plain icon avatars, purely for a nicer demo — genuine new signups get the gender-icon default until they upload their own photo.

## 10. Known limitations (by design, not oversights)

- **Avatar/image uploads**: fully implemented for both students and tutors (JPG/PNG/WEBP, 2MB limit) via the "Change Photo" control on the profile page — this overrides the gender-based default avatar.
- **Forgot Password**: the form and validation are fully functional, but no real email is sent (that requires an SMTP/email service, which is outside a self-contained local project). It confirms the flow without delivering an email.
- **Earnings** are a simple estimate (`completed sessions × hourly rate`), not a real payments/payout integration.
- **Admin "Manage Messages"** is a read-only moderation view of the most recent messages, not a full moderation/delete workflow — the brief only asked for a `messages` table and this overview.

Every button and link in the UI leads to a real, working page or action — nothing is a placeholder.
