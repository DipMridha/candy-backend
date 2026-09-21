const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// Firebase Admin
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Home
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Candy backend is running"
  });
});

// Firebase test
app.get("/firebase-test", async (req, res) => {
  try {
    await admin.auth().listUsers(1);

    res.json({
      status: "ok",
      firebase: "connected"
    });
  } catch (error) {
    console.error("Firebase error:", error);

    res.status(500).json({
      status: "error",
      firebase: "connection failed",
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Candy backend running on port ${PORT}`);
});
