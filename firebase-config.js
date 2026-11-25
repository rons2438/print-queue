// Same Firebase project as the Plainview Baptist Church app.
// Copied from https://github.com/plainviewbaptist/plainviewbaptist.github.io/blob/main/firebase-config.js
// The web key is public. Firestore and Storage rules decide what visitors can do.

export const firebaseConfig = {
  apiKey: "AIzaSyCwBzRF81XenglC8FGwux_m-z1vkqAeyN0",
  authDomain: "plainview-baptist-church-bfe21.firebaseapp.com",
  projectId: "plainview-baptist-church-bfe21",
  storageBucket: "plainview-baptist-church-bfe21.firebasestorage.app",
  messagingSenderId: "874031976146",
  appId: "1:874031976146:web:cea752e18302f69424670b",
};

// Optional extra admins, besides church-app admins and the church owner.
// Use the email they sign in with, lowercase. The same emails must be
// listed in firestore.rules (function pqIsListedAdmin) before you publish.
export const adminEmails = [
  // "you@example.com",
];
