# Sellers Family Print Queue

Share this page with the family:

**https://rons2438.github.io/print-queue/**

On an iPhone: open that link in Safari, tap the Share button, then **Add to Home Screen**. The icon is a photo of Ronald's printer.

## How the family uses it

The first screen is **Sellers Family Print Queue**. Each person has a tile with an emoji (or their photo) and a number. The number is how many requests they have, and it updates live.

Tap your name. On your page:

- You see your requests, newest first, with the model link, notes, and a status: Suggested, Queued, Printing, or Done.
- You can filter by status.
- Add a request with a title, the model link (Printables, Thingiverse, MakerWorld, or any normal web address), and optional notes such as color, size, or who it's for. Your name is already filled in from the tile you tapped.
- **Add your photo** replaces the emoji. The picture is shrunk on your phone first, then saved so everyone else sees the same photo. **Use the emoji** puts the emoji back.

Nobody needs an account to suggest a print or to set a photo.

There is also a link, **See the whole queue**, for the combined list.

Each request shows a picture above the model link. The app looks up the picture from the model page (MakerWorld, Thingiverse, and a page photo for Printables). You can also attach your own photo when you submit, or add one later. The first time a picture is found, it is saved on that request so it does not have to be looked up again.

On the name picker, a soft dark shade and a thin light ring show print progress, like an app download. Queued is one quarter, Printing is half, and Done is full. Suggested does not count. If someone has several of those, the ring is the average (one Queued and one Printing is about 38%). When everything counted is Done, the ring is full. A request's own picture uses that same ring for its own status.

If request pictures do not stay for everyone, publish the print-queue rules again (steps 2 and 3 below). The blocks in this project now include the picture fields and a `print-queue/requests/` folder. Paste those updated blocks over the old print-queue blocks only. Leave the church rules in place.

## What Ronald can do

At the bottom of the page, open **Ronald's sign-in**. Sign in with the same account you use for the Plainview Baptist Church app.

- If that account is a church admin, or the church owner, you can change a request's status and delete a request.
- Family members are not signed in, so they cannot change or delete someone else's request.
- On an iPhone that you added to the Home Screen, email and password is the reliable sign-in. Google sign-in works best in Safari. If you have only used Google before, type your email and tap **Email me a password link**, then come back and sign in.

## Add or rename a person

Open `profiles.js`. Each person is one line: an id, a name, an emoji, and a color.

- To add someone, copy a line and change all four.
- The id is lowercase letters, numbers, or dashes. No spaces. Do not change an id later. Requests and the photo are tied to that id.
- The name, emoji, and color are safe to change.
- After the change is on the `main` branch, GitHub Pages publishes it. That is the only place the list of people lives, so you do not edit it inside Firebase.

## Printer photo

The header and the home-screen icon are a real product photo of the **Bambu Lab P1S AMS 2 Pro Combo** (the P1S with an AMS 2 Pro on top, not the original AMS and not a bare P1S).

- Source: [Bambu Lab US store, P1S AMS 2 Pro Combo](https://us.store.bambulab.com/products/p1s?id=732843418674327566)
- Image file: [P1SC2.jpg on the Bambu Lab CDN](https://store.bblcdn.com/s7/default/2ea6f1d3770c459db1c22f4d767287ff/P1SC2.jpg)
- The orange sale sticker and the footnote were cropped off. The printer itself was not redrawn or generated. The unit on top is labeled AMS 2 Pro, and the printer is labeled P1S.

## Where the data lives

This app uses the same Firebase project as the church app at https://plainviewbaptist.github.io:

- Project: `plainview-baptist-church-bfe21`
- The web config was copied from [firebase-config.js in the church site repo](https://github.com/plainviewbaptist/plainviewbaptist.github.io/blob/main/firebase-config.js)
- Requests are stored in a Firestore collection named `printSuggestions`
- Profile photo links are stored in `printProfiles`
- The picture files are stored in Cloud Storage at `print-queue/profiles/`

None of those names are used by the church app. Church collections and church pictures are left alone.

The church site's public GitHub repo does **not** include the live security rules. Those rules only exist in the Firebase console, so they could not be copied from GitHub. The files `firestore.rules` and `storage.rules` in this repo contain the new print-queue blocks, with a marked place to keep the church rules when you publish.

## One-time setup (Ronald)

The app is already pointed at the church Firebase project. Four things still have to be done by hand in the browser. You only do them once.

### 1. Let this website sign you in

1. Open [Firebase Authentication settings](https://console.firebase.google.com/project/plainview-baptist-church-bfe21/authentication/settings).
2. Under **Authorized domains**, click **Add domain**.
3. Type `rons2438.github.io` and save.

Until this is done, Ronald's sign-in on the print page will say the website isn't allowed. The church app is not affected.

Email/password sign-in and Google sign-in are already turned on for the church app, so you do not need to enable a new provider.

### 2. Publish the database rules without breaking the church app

1. Open [Firestore rules](https://console.firebase.google.com/project/plainview-baptist-church-bfe21/firestore/rules). You should see the rules the church app already uses. Leave them.
2. On GitHub, open `firestore.rules` in this project. Copy **only** the block between `BEGIN PRINT QUEUE` and `END PRINT QUEUE` (the functions and the two `match` blocks).
3. Paste that block inside the church rules, just before the final closing braces, next to the other `match` blocks.
4. Do not delete any church lines. Do not replace the whole page with this file. That would lock the church app.
5. Click **Publish**.

The first line of the rules should already say `rules_version = '2';`. If it does, leave it.

### 3. Publish the photo rules without breaking church pictures

Profile photos use Firebase Storage, which the church app already uses for flyers, videos, and avatars. This app only adds a folder named `print-queue/profiles/`.

1. Open [Storage rules](https://console.firebase.google.com/project/plainview-baptist-church-bfe21/storage/rules).
2. On GitHub, open `storage.rules`. Copy **only** the block between `BEGIN PRINT QUEUE STORAGE` and `END PRINT QUEUE STORAGE`.
3. Paste it inside the existing storage rules, next to the church `match` blocks. Do not delete the church lines.
4. Click **Publish**.

Paste this into **Storage** rules, not Firestore rules. They are different pages in the console.

After steps 2 and 3, requests save and photos show up for everyone. If only step 2 is done, the queue works and photos show a short message until step 3 is done.

### 4. The public website

Merging to `main` runs a GitHub Actions workflow that publishes the site and turns GitHub Pages on the first time. The address is:

https://rons2438.github.io/print-queue/

If that link is still a “404” after the Actions run finishes, turn Pages on by hand:

1. Open this repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. If that choice is not there, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Open the **Actions** tab, open the failed “Deploy GitHub Pages” run, and click **Re-run**.

## If sign-in works but you cannot change status

Church admins and the church owner can already edit the queue. You only need this if your church account is not an admin.

1. In `firebase-config.js`, put your email inside `adminEmails`, in quotes, lowercase.
2. In `firestore.rules`, replace the `return false;` line inside `pqIsListedAdmin` with:

```
return request.auth != null
  && request.auth.token.email != null
  && request.auth.token.email.lower() == "you@example.com";
```

3. Paste the updated print-queue block into the Firestore rules and publish again (step 2). Use the same email in both places.
