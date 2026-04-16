# Setup Checklist - Catalyst Magazine CMS

Use this checklist to ensure everything is set up correctly.

## ☐ Pre-Setup

- [ ] Node.js is installed (check with `node --version`)
- [ ] You have access to Firebase Console
- [ ] You have a text editor ready

## ☐ Step 1: Install Dependencies

```bash
cd /Users/yairben-dor/XCode/CatalystMagazine
npm install
```

- [ ] npm install completed without errors
- [ ] `node_modules` folder created
- [ ] Express and cors packages installed

## ☐ Step 2: Firebase Authentication

Go to: https://console.firebase.google.com/project/catalystwriters-5ce43/authentication

- [ ] Clicked "Authentication" in left sidebar
- [ ] Clicked "Get Started"
- [ ] Selected "Email/Password" provider
- [ ] Enabled "Email/Password" sign-in method
- [ ] Clicked "Save"

## ☐ Step 3: Firestore Database

Go to: https://console.firebase.google.com/project/catalystwriters-5ce43/firestore

- [ ] Clicked "Firestore Database" in left sidebar
- [ ] Clicked "Create database"
- [ ] Selected "Start in production mode"
- [ ] Chose a location
- [ ] Database created successfully

### Set Firestore Security Rules

- [ ] Clicked "Rules" tab
- [ ] Copied rules from `CMS-SETUP.md`
- [ ] Pasted into rules editor
- [ ] Clicked "Publish"
- [ ] Rules published successfully

## ☐ Step 4: Firebase Storage

Go to: https://console.firebase.google.com/project/catalystwriters-5ce43/storage

- [ ] Clicked "Storage" in left sidebar
- [ ] Clicked "Get Started"
- [ ] Accepted default security rules
- [ ] Clicked "Done"
- [ ] Storage bucket created

### Set Storage Security Rules

- [ ] Clicked "Rules" tab
- [ ] Copied storage rules from `CMS-SETUP.md`
- [ ] Pasted into rules editor
- [ ] Clicked "Publish"
- [ ] Rules published successfully

## ☐ Step 5: Start the Server

```bash
npm start
```

- [ ] Server started without errors
- [ ] See message: "Server is running on http://localhost:3000"
- [ ] No error messages in console

## ☐ Step 6: Create Admin Account

Open browser to: http://localhost:3000/writer-login.html

- [ ] Page loads successfully
- [ ] Clicked "Sign Up"
- [ ] Entered name, email, and password
- [ ] Account created successfully
- [ ] Redirected to writer dashboard

### Upgrade to Admin

Go to: https://console.firebase.google.com/project/catalystwriters-5ce43/firestore/data

- [ ] Opened Firestore Database
- [ ] Found `users` collection
- [ ] Found your user document
- [ ] Clicked to edit
- [ ] Changed `role` field from `"writer"` to `"admin"`
- [ ] Saved changes

## ☐ Step 7: Test Writer Account

Open: http://localhost:3000/writer-login.html

- [ ] Logged in successfully
- [ ] Redirected to admin dashboard (because you're admin)
- [ ] Can see admin interface

Create a test writer account:

- [ ] Logged out
- [ ] Created second account (this will be a writer)
- [ ] Logged in with new account
- [ ] Redirected to writer dashboard
- [ ] Can see rich text editor

## ☐ Step 8: Test Story Creation

In writer dashboard:

- [ ] Clicked "New Story"
- [ ] Entered article title
- [ ] Selected category
- [ ] Added tags
- [ ] Uploaded cover image
- [ ] Image preview shows
- [ ] Wrote content in editor
- [ ] Formatting tools work (bold, italic, etc.)
- [ ] Clicked "Submit for Review"
- [ ] Success message appears
- [ ] Story appears in "My Stories" tab

## ☐ Step 9: Test Admin Review

Log in as admin: http://localhost:3000/writer-login.html

- [ ] Can see admin dashboard
- [ ] Pending count shows 1
- [ ] Story appears in pending list
- [ ] Can see story title, author, content
- [ ] Cover image displays

## ☐ Step 10: Test Publishing

In admin dashboard:

- [ ] Clicked "Approve & Publish"
- [ ] No errors in browser console
- [ ] Story status updated to "published"
- [ ] HTML file created in `/posts/published/`
- [ ] Can open generated HTML file
- [ ] Article looks good

## ☐ Step 11: Verify Files

Check that these files exist:

- [ ] `writer-login.html`
- [ ] `writer-dashboard.html`
- [ ] `admin-dashboard.html`
- [ ] `server.js`
- [ ] `publish-article.js`
- [ ] `package.json`
- [ ] `js/firebase-config.js`
- [ ] `node_modules/` (folder)
- [ ] `posts/published/` (folder)

## ☐ Step 12: Test All Features

### Writer Features
- [ ] Create new story
- [ ] Save as draft
- [ ] Edit draft
- [ ] Upload different image
- [ ] Use all formatting options
- [ ] Add links
- [ ] Add images in content
- [ ] Submit for review
- [ ] View submission status

### Admin Features
- [ ] View all pending stories
- [ ] Filter by status
- [ ] Review story content
- [ ] Approve story
- [ ] Reject story
- [ ] Publish approved story
- [ ] View statistics

## ☐ Final Checks

- [ ] No console errors
- [ ] All buttons work
- [ ] Images upload correctly
- [ ] Articles publish successfully
- [ ] Generated HTML looks good
- [ ] Mobile responsive (test on phone)

## ☐ Optional Customizations

- [ ] Changed editor toolbar (if desired)
- [ ] Added more categories
- [ ] Updated article template styling
- [ ] Added custom branding
- [ ] Modified dashboard colors

## ☐ Production Preparation

- [ ] Updated API URL in `admin-dashboard.html`
- [ ] Tested on production server
- [ ] Updated Firebase security rules for production
- [ ] Created deployment plan

## 🎉 Success!

If all items are checked, your CMS is fully set up and ready to use!

## 📞 Troubleshooting

If something doesn't work:

1. **Check browser console** for errors
2. **Check Firebase Console** for issues
3. **Check server console** for API errors
4. **Review security rules** in Firebase
5. **Verify all files** are in correct locations

## 📚 Next Steps

- [ ] Read [QUICK-START.md](QUICK-START.md)
- [ ] Review [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md)
- [ ] Invite team members
- [ ] Create content guidelines
- [ ] Set up regular publishing schedule

---

**Need help?** Check the documentation files or review the Firebase Console for detailed error messages.
