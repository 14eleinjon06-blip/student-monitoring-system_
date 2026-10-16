# Student Monitoring System — ID Scan & Face Recognition

A responsive Next.js demo dashboard for student attendance. Includes ID entry/keyboard-wedge scanner support, webcam QR/barcode scanning, student directory, attendance logs, CSV export, and browser-based face matching.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Features
- Scan a student ID using a USB barcode scanner (it types into the focused ID field), or enter the ID manually.
- Use the webcam QR/barcode reader for supported student IDs.
- Add student records.
- Enroll a face for each student using the webcam and compare a live face descriptor against enrolled descriptors.
- View daily attendance records and export CSV.

## Important demo limitations
- Face recognition loads the open-source face-api library and model weights from jsDelivr, so the browser needs internet access. Camera use requires HTTPS (Vercel provides HTTPS) or localhost and browser permission.
- Face descriptors and attendance records are stored in the current browser's localStorage. They do not sync between devices or browsers and can be lost if browser data is cleared. Enroll faces again on every new browser/device.
- This is a student prototype, not a secure production attendance system. Face matching can make mistakes and is not proof of identity. Provide a manual alternative, obtain consent before collecting biometric data, and follow applicable privacy rules. Do not use it for high-stakes decisions without proper testing and safeguards.
- Demo records are sample data and should be replaced with authorized student records.

## Deployment
Import this GitHub repository into Vercel and use the default Next.js settings. No environment variables are required.
