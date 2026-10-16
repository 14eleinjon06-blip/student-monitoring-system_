"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

type Student = { id: string; name: string; course: string; year: string; photo?: string; descriptor?: number[] };
type Attendance = { id: string; name: string; time: string; method: string; date: string };
declare global { interface Window { faceapi?: any; Tesseract?: any } }

const initialStudents: Student[] = [
  { id: "2026-001", name: "Alex Santos", course: "BS Information Technology", year: "3rd Year" },
  { id: "2026-002", name: "Jamie Cruz", course: "BS Information Technology", year: "2nd Year" },
  { id: "2026-003", name: "Taylor Reyes", course: "BS Computer Science", year: "1st Year" },
];

export default function Home() {
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [idInput, setIdInput] = useState("");
  const [activeTab, setActiveTab] = useState<"id" | "face">("id");
  const [status, setStatus] = useState("Ready to scan an ID or recognize an enrolled face.");
  const [cameraOn, setCameraOn] = useState(false);
  const [qrScanning, setQrScanning] = useState(false);
  const [printedIdScanning, setPrintedIdScanning] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newCourse, setNewCourse] = useState("BS Information Technology");
  const [newYear, setNewYear] = useState("1st Year");
  const [showAdd, setShowAdd] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const printedScanStopRef = useRef<(() => void) | null>(null);
  const ocrWorkerRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedStudents = localStorage.getItem("sms_students_v2");
      const savedAttendance = localStorage.getItem("sms_attendance_v2");
      setStudents(savedStudents ? JSON.parse(savedStudents) : initialStudents);
      setAttendance(savedAttendance ? JSON.parse(savedAttendance) : []);
    } catch {
      setStudents(initialStudents);
      setAttendance([]);
    }
  }, []);

  useEffect(() => { if (students.length) localStorage.setItem("sms_students_v2", JSON.stringify(students)); }, [students]);
  useEffect(() => { localStorage.setItem("sms_attendance_v2", JSON.stringify(attendance)); }, [attendance]);

  const markAttendance = useCallback((student: Student, method: string) => {
    const now = new Date();
    const date = now.toLocaleDateString();
    const exists = attendance.some((a) => a.id === student.id && a.date === date);
    if (exists) {
      setStatus(`${student.name} already has an attendance record for today.`);
      return;
    }
    setAttendance((prev) => [{ id: student.id, name: student.name, time: now.toLocaleTimeString(), method, date }, ...prev]);
    setStatus(`Attendance recorded for ${student.name} using ${method}.`);
  }, [attendance]);

  const scanId = (value = idInput) => {
    const key = value.trim().toLowerCase();
    if (!key) { setStatus("Enter or scan a student ID first."); return; }
    const student = students.find((s) => s.id.toLowerCase() === key);
    if (!student) { setStatus(`No student found for ID “${value.trim()}”. Add the student first.`); return; }
    markAttendance(student, "ID Scan");
    setIdInput("");
  };

  const loadModels = async () => {
    if (window.faceapi) { setModelsReady(true); return window.faceapi; }
    setStatus("Loading face recognition models… this may take a moment.");
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load face recognition library. Check your internet connection."));
      document.head.appendChild(script);
    });
    const api = window.faceapi;
    const base = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/";
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri(base),
      api.nets.faceLandmark68Net.loadFromUri(base),
      api.nets.faceRecognitionNet.loadFromUri(base),
    ]);
    setModelsReady(true);
    setStatus("Face recognition models loaded. Enroll a face before scanning.");
    return api;
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported here. Open the site over HTTPS or use ID Scan.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
      await loadModels();
    } catch (e: any) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
      setStatus(e?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings, then try again." : (e?.message || "Unable to start camera."));
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setFaceBusy(false);
  };

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); scannerControlsRef.current?.stop(); scannerControlsRef.current = null; printedScanStopRef.current?.(); }, []);

  const getDescriptor = async (input: HTMLVideoElement | HTMLImageElement) => {
    const api = await loadModels();
    const result = await api.detectSingleFace(input, new api.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks().withFaceDescriptor();
    if (!result) throw new Error("No clear face found. Face the camera and try again with good lighting.");
    return Array.from(result.descriptor) as number[];
  };

  const enrollFace = async (student: Student) => {
    if (!videoRef.current || !cameraOn) { setStatus("Start the camera first."); return; }
    setFaceBusy(true);
    try {
      const descriptor = await getDescriptor(videoRef.current);
      setStudents((prev) => prev.map((s) => s.id === student.id ? { ...s, descriptor } : s));
      setStatus(`Face enrolled for ${student.name}. You can now use Face Recognition.`);
    } catch (e: any) { setStatus(e?.message || "Could not enroll face."); }
    finally { setFaceBusy(false); }
  };

  const recognizeFace = async () => {
    if (!videoRef.current || !cameraOn) { setStatus("Start the camera first."); return; }
    setFaceBusy(true);
    try {
      const descriptor = await getDescriptor(videoRef.current);
      const candidates = students.filter((s) => s.descriptor?.length);
      if (!candidates.length) throw new Error("No faces are enrolled yet. Select a student below and choose Enroll Face.");
      const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, v, i) => sum + Math.pow(v - b[i], 2), 0));
      const matches = candidates.map((s) => ({ student: s, distance: distance(descriptor, s.descriptor!) })).sort((a, b) => a.distance - b.distance);
      if (!matches[0] || matches[0].distance > 0.52) throw new Error("No confident match found. Try again or enroll this student’s face.");
      markAttendance(matches[0].student, "Face Recognition");
      setStatus(`Recognized ${matches[0].student.name} (match distance ${matches[0].distance.toFixed(2)}).`);
    } catch (e: any) { setStatus(e?.message || "Face recognition failed."); }
    finally { setFaceBusy(false); }
  };

  const startQrScanner = () => {
    setQrScanning(true);
    setStatus("Point the camera at a student ID QR code or barcode…");
  };

  const startPrintedIdScanner = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access needs HTTPS or localhost. You can still enter the ID manually.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setPrintedIdScanning(true);
      setStatus("Hold the front of the card steady, with the printed I.D. NO. visible.");
    } catch (e: any) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus(e?.message || "Unable to start the camera.");
    }
  };

  useEffect(() => {
    if (!printedIdScanning || activeTab !== "id" || !videoRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const video = videoRef.current;
    if (streamRef.current && video.srcObject !== streamRef.current) { video.srcObject = streamRef.current; void video.play(); }
    const stop = () => {
      active = false;
      if (timer) clearTimeout(timer);
      void ocrWorkerRef.current?.terminate?.();
      ocrWorkerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
      setPrintedIdScanning(false);
    };
    printedScanStopRef.current = stop;
    const scanFrame = async () => {
      if (!active || busy || !video.videoWidth) {
        if (active) timer = setTimeout(scanFrame, 500);
        return;
      }
      busy = true;
      try {
        if (!ocrWorkerRef.current) {
          if (!window.Tesseract) {
            await new Promise<void>((resolve, reject) => {
              const script = document.createElement("script");
              script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
              script.onload = () => resolve();
              script.onerror = () => reject(new Error("Could not load text scanning. Check your internet connection."));
              document.head.appendChild(script);
            });
          }
          ocrWorkerRef.current = await window.Tesseract.createWorker("eng");
        }
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        const { data } = await ocrWorkerRef.current.recognize(canvas);
        const text = String(data?.text || "");
        const labeled = text.match(/\bI\s*\.?\s*D\s*\.?\s*(?:NO|NUMBER)\s*\.?\s*[:#]?\s*([0-9OIl]{3})\s*[-–— ]?\s*([0-9OIl]{4})/i);
        if (labeled) {
          const normalize = (part: string) => part.toUpperCase().replace(/[O]/g, "0").replace(/[IL]/g, "1");
          const id = `${normalize(labeled[1])}-${normalize(labeled[2])}`;
          setIdInput(id);
          setStatus(`Read ID ${id}. Check the number, then select Verify ID to record attendance.`);
          stop();
          return;
        }
      } catch (e: any) {
        if (active) { setStatus(e?.message || "Could not read the printed ID. Try improving the lighting or enter it manually."); stop(); }
        return;
      } finally { busy = false; }
      if (active) timer = setTimeout(scanFrame, 350);
    };
    setStatus("Starting text scanner… Point at the front card’s I.D. NO. and hold steady.");
    void scanFrame();
    return () => { stop(); printedScanStopRef.current = null; };
  }, [printedIdScanning, activeTab]);

  useEffect(() => {
    if (!qrScanning || activeTab !== "id" || !videoRef.current) return;
    let active = true;
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (!result || !active) return;
      active = false;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      setQrScanning(false);
      const scanned = result.getText().trim();
      setIdInput(scanned);
      const found = students.find((s) => s.id.toLowerCase() === scanned.toLowerCase());
      if (found) markAttendance(found, "QR / Barcode Scan");
      else setStatus(`Scanned “${scanned}” but no matching student ID exists.`);
    }).then((controls) => {
      if (!active) controls.stop();
      else scannerControlsRef.current = controls;
    }).catch((e: any) => {
      if (active) setStatus(e?.message || "Unable to start ID camera scanner.");
      setQrScanning(false);
    });
    return () => {
      active = false;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [qrScanning, activeTab, students, markAttendance]);

  const addStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || !newName.trim()) { setStatus("Student ID and name are required."); return; }
    if (students.some((s) => s.id.toLowerCase() === newId.trim().toLowerCase())) { setStatus("That student ID already exists."); return; }
    setStudents((prev) => [...prev, { id: newId.trim(), name: newName.trim(), course: newCourse, year: newYear }]);
    setNewId(""); setNewName(""); setShowAdd(false);
    setStatus("Student added. Start the camera and enroll their face to enable recognition.");
  };

  const exportCsv = () => {
    const csv = ["Student ID,Name,Date,Time,Method", ...attendance.map((a) => [a.id, a.name, a.date, a.time, a.method].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "student-attendance.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const today = new Date().toLocaleDateString();
  const todayCount = attendance.filter((a) => a.date === today).length;
  const enrolledCount = students.filter((s) => s.descriptor?.length).length;

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">S</div><div><strong>STUDENT<span>MONITOR</span></strong><small>ATTENDANCE PORTAL</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className="nav-item active" onClick={() => setActiveTab("id")}>▦ <span>Dashboard</span></button>
      <button className="nav-item" onClick={() => { setActiveTab("id"); document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth" }); }}>▤ <span>ID Scan</span></button>
      <button className="nav-item" onClick={() => { setActiveTab("face"); document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth" }); }}>◎ <span>Face Recognition</span></button>
      <button className="nav-item" onClick={() => document.getElementById("students")?.scrollIntoView({ behavior: "smooth" })}>♙ <span>Students</span></button>
      <button className="nav-item" onClick={() => document.getElementById("records")?.scrollIntoView({ behavior: "smooth" })}>▧ <span>Attendance Records</span></button>
      <div className="sidebar-bottom"><div className="secure-dot" /> Browser-based demo<br /><small>Data stored on this device</small></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><div className="eyebrow">CAMPUS OPERATIONS / ATTENDANCE</div><h1>Student Monitoring System</h1><p>Manage student attendance with ID scanning and face recognition.</p></div><div className="date-pill">◷ {new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</div></header>
      <div className="stats">
        <article className="stat-card"><div className="stat-icon blue">♙</div><div><span>REGISTERED STUDENTS</span><strong>{students.length}</strong><small>Student profiles</small></div></article>
        <article className="stat-card"><div className="stat-icon green">✓</div><div><span>ATTENDANCE TODAY</span><strong>{todayCount}</strong><small>Unique student records</small></div></article>
        <article className="stat-card"><div className="stat-icon purple">◎</div><div><span>FACES ENROLLED</span><strong>{enrolledCount}</strong><small>Ready for matching</small></div></article>
      </div>
      <section className="panel scanner-panel" id="scanner">
        <div className="panel-heading"><div><div className="eyebrow">QUICK ATTENDANCE</div><h2>Identify Student</h2><p>Choose an ID scan or face recognition method.</p></div><span className="live-badge"><i /> SYSTEM READY</span></div>
        <div className="tabs"><button className={activeTab === "id" ? "tab selected" : "tab"} onClick={() => setActiveTab("id")}>▤ ID Scan</button><button className={activeTab === "face" ? "tab selected" : "tab"} onClick={() => setActiveTab("face")}>◎ Face Recognition</button></div>
        {activeTab === "id" ? <div className="scan-content">
          {(qrScanning || printedIdScanning) && <div className="camera-frame qr-camera"><video ref={videoRef} autoPlay muted playsInline /><div className="face-guide" /><span className="scan-camera-label">{printedIdScanning ? "Keep the I.D. NO. in view" : "Align QR code or barcode"}</span></div>}
          <div className="scan-illustration"><div className="id-card-graphic"><div className="avatar-placeholder">♙</div><div className="fake-lines"><b /><i /><i /></div><div className="barcode">▥ ▥ ▥ ▥ ▥ ▥ ▥</div></div><div className="scan-ring">▤</div></div>
          <div className="scan-form"><h3>Scan student ID</h3><p>Use a USB scanner, scan a QR code or barcode, read the printed I.D. NO. from your card, or enter it manually.</p>
            <form onSubmit={(e) => { e.preventDefault(); scanId(); }}><label htmlFor="student-id">STUDENT ID NUMBER</label><div className="input-row"><input id="student-id" autoFocus value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder="e.g. 2026-001" /><button className="primary-btn" type="submit">Verify ID <span>→</span></button></div></form>
            <div className="button-row scan-buttons"><button className="secondary-btn" onClick={() => qrScanning ? setQrScanning(false) : startQrScanner()}>{qrScanning ? "Stop barcode scanner" : "◎ Scan QR / barcode"}</button><button className="secondary-btn" onClick={() => printedIdScanning ? printedScanStopRef.current?.() : void startPrintedIdScanner()}>{printedIdScanning ? "Stop text scanner" : "▤ Read printed ID number"}</button></div>
            <div className="hint">Printed ID reading looks for the number beside “I.D. NO.” on the front of your card. Check the result before verifying. The student must already be in the directory. Demo IDs: {students.slice(0, 3).map((s) => s.id).join(" · ") || "Add a student to begin"}</div>
          </div>
        </div> : <div className="face-content">
          <div className="camera-frame">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder"><div className="face-outline">◯</div><strong>Camera is off</strong><span>Turn on the camera to enroll or recognize a face.</span></div>}{cameraOn && <div className="face-guide" />}</div>
          <div className="face-controls"><h3>Face recognition</h3><p>Enroll each student’s face once. The browser compares a live face descriptor against enrolled student profiles.</p>
            {!cameraOn ? <button className="primary-btn" onClick={startCamera}>Enable camera <span>→</span></button> : <><div className="button-row"><button className="primary-btn" disabled={faceBusy || !modelsReady} onClick={recognizeFace}>{faceBusy ? "Checking…" : "Recognize face"}</button><button className="secondary-btn" onClick={stopCamera}>Turn off camera</button></div><label htmlFor="enroll-student">ENROLL FACE FOR STUDENT</label><select id="enroll-student" defaultValue="" onChange={(e) => { const s = students.find((x) => x.id === e.target.value); if (s) void enrollFace(s); }}><option value="" disabled>Select student, then capture face</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.id}{s.descriptor?.length ? " (enrolled)" : ""}</option>)}</select></>}
            <div className="hint">{modelsReady ? "Face models loaded" : "Recognition requires internet access to load AI models."} Face data is kept in this browser only.</div>
          </div>
        </div>}
        <div className={status.toLowerCase().includes("recorded") ? "status-message success" : "status-message"} role="status"><span>ⓘ</span>{status}</div>
      </section>
      <section className="panel" id="students">
        <div className="panel-heading"><div><div className="eyebrow">DIRECTORY</div><h2>Student Directory</h2><p>Manage registered student profiles and face enrollment.</p></div><button className="primary-btn" onClick={() => setShowAdd((v) => !v)}>＋ Add Student</button></div>
        {showAdd && <form className="add-form" onSubmit={addStudent}><input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="Student ID" required /><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" required /><select value={newCourse} onChange={(e) => setNewCourse(e.target.value)}><option>BS Information Technology</option><option>BS Computer Science</option><option>BS Information Systems</option><option>Other</option></select><select value={newYear} onChange={(e) => setNewYear(e.target.value)}><option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option></select><button className="primary-btn" type="submit">Save student</button></form>}
        <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>STUDENT ID</th><th>COURSE / YEAR</th><th>FACE PROFILE</th></tr></thead><tbody>{students.map((s) => <tr key={s.id}><td><div className="student-cell"><div className="student-avatar">{s.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</div><strong>{s.name}</strong></div></td><td className="mono">{s.id}</td><td>{s.course}<small className="subline">{s.year}</small></td><td>{s.descriptor?.length ? <span className="pill enrolled">✓ Enrolled</span> : <span className="pill not-enrolled">Not enrolled</span>}</td></tr>)}</tbody></table>{!students.length && <div className="empty-state">No students yet. Add a student to begin.</div>}</div>
      </section>
      <section className="panel" id="records">
        <div className="panel-heading"><div><div className="eyebrow">ATTENDANCE LOG</div><h2>Recent Attendance</h2><p>Latest successful ID scans and face matches.</p></div><button className="secondary-btn" onClick={exportCsv} disabled={!attendance.length}>↓ Export CSV</button></div>
        <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>DATE / TIME</th><th>METHOD</th><th>STATUS</th></tr></thead><tbody>{attendance.slice(0, 20).map((a, i) => <tr key={a.id + a.date}><td><div className="student-cell"><div className="student-avatar">{a.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</div><div><strong>{a.name}</strong><small className="subline mono">{a.id}</small></div></div></td><td>{a.date}<small className="subline">{a.time}</small></td><td><span className="method-tag">{a.method}</span></td><td><span className="pill enrolled">✓ Recorded</span></td></tr>)}</tbody></table>{!attendance.length && <div className="empty-state"><div className="empty-icon">▧</div><strong>No attendance records yet</strong><span>Scan a student ID or recognize an enrolled face to record attendance.</span></div>}</div>
      </section>
      <footer>STUDENT MONITORING SYSTEM <span>•</span> ID SCANNING & FACE RECOGNITION <span>•</span> DEMO BUILD</footer>
    </section>
  </main>;
}
