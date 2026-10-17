"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Student = { id: string; name: string; course: string; year: string; photo?: string; descriptor?: number[] };
type Attendance = { id: string; name: string; time: string; method: string; date: string };
declare global { interface Window { faceapi?: any; Tesseract?: any } }

const demoStudents = [
  { id: "2026-001", name: "Alex Santos" },
  { id: "2026-002", name: "Jamie Cruz" },
  { id: "2026-003", name: "Taylor Reyes" },
];

export default function Home() {
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [idInput, setIdInput] = useState("");
  const [activeTab, setActiveTab] = useState<"id" | "face">("id");
  const [status, setStatus] = useState("Ready to scan an ID or recognize an enrolled face.");
  const [cameraOn, setCameraOn] = useState(false);
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
  const printedScanStopRef = useRef<(() => void) | null>(null);
  const ocrWorkerRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedStudents = localStorage.getItem("sms_students_v2");
      const savedAttendance = localStorage.getItem("sms_attendance_v2");
      const storedStudents = savedStudents ? JSON.parse(savedStudents) as Student[] : [];
      const oldDemoProfiles = new Set(demoStudents.map((student) => `${student.id}|${student.name}`));
      setStudents(Array.isArray(storedStudents) ? storedStudents.filter((student) => !oldDemoProfiles.has(`${student.id}|${student.name}`)) : []);
      const storedAttendance = savedAttendance ? JSON.parse(savedAttendance) as Attendance[] : [];
      setAttendance(Array.isArray(storedAttendance) ? storedAttendance.filter((record) => !oldDemoProfiles.has(`${record.id}|${record.name}`)) : []);
    } catch {
      setStudents([]);
      setAttendance([]);
    }
  }, []);

  useEffect(() => { localStorage.setItem("sms_students_v2", JSON.stringify(students)); }, [students]);
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

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); printedScanStopRef.current?.(); }, []);

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



  const addStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || !newName.trim()) { setStatus("Student ID and name are required."); return; }
    if (students.some((s) => s.id.toLowerCase() === newId.trim().toLowerCase())) { setStatus("That student ID already exists."); return; }
    setStudents((prev) => [...prev, { id: newId.trim(), name: newName.trim(), course: newCourse, year: newYear }]);
    setNewId(""); setNewName(""); setShowAdd(false);
    setStatus("Student added. Start the camera and enroll their face to enable recognition.");
  };

  const removeStudent = (student: Student) => {
    if (!window.confirm(`Delete ${student.name} from the student directory?`)) return;
    setStudents((prev) => prev.filter((s) => s.id !== student.id));
    setStatus(`${student.name} was deleted from the student directory.`);
  };

  const exportCsv = () => {
    const csv = ["Student ID,Name,Date,Time,Method", ...attendance.map((a) => [a.id, a.name, a.date, a.time, a.method].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "student-attendance.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const today = new Date().toLocaleDateString();
  const presentCount = new Set(attendance.filter((a) => a.date === today).map((a) => a.id)).size;
  const absentCount = Math.max(0, students.length - presentCount);
  const enrolledCount = students.filter((s) => s.descriptor?.length).length;

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">S</div><div><strong>STUDENT<span>MONITOR</span></strong><small>ATTENDANCE PORTAL</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className="nav-item active" onClick={() => setActiveTab("id")}>▦ <span>Dashboard</span></button>
      <button className="nav-item" onClick={() => { setActiveTab("id"); document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth" }); }}>▤ <span>PICTURE / SCANNER / ID SCANNER</span></button>
      <button className="nav-item" onClick={() => { setActiveTab("face"); document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth" }); }}>◎ <span>Face Recognition</span></button>
      <button className="nav-item" onClick={() => document.getElementById("students")?.scrollIntoView({ behavior: "smooth" })}>♙ <span>STUDENT INFORMATION</span></button>
      <button className="nav-item" onClick={() => document.getElementById("records")?.scrollIntoView({ behavior: "smooth" })}>▧ <span>VIEW ATTENDANCE REPORT</span></button>
      <div className="sidebar-bottom"><div className="secure-dot" /> Browser-based demo<br /><small>Data stored on this device</small></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><div className="eyebrow">CAMPUS OPERATIONS / ATTENDANCE</div><h1>Student Monitoring System</h1><p>Manage student attendance with ID scanning and face recognition.</p></div><div className="date-pill">◷ {new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</div></header>
      <div className="stats">
        <article className="stat-card"><div className="stat-icon blue">♙</div><div><span>TOTAL STUDENT</span><strong>{students.length}</strong><small>Registered students</small></div></article>
        <article className="stat-card"><div className="stat-icon green">✓</div><div><span>PRESENT</span><strong>{presentCount}</strong><small>Attendance recorded today</small></div></article>
        <article className="stat-card"><div className="stat-icon purple">◎</div><div><span>ABSENT</span><strong>{absentCount}</strong><small>Not yet recorded today</small></div></article>
      </div>
      <section className="panel scanner-panel" id="scanner">
        <div className="panel-heading"><div><div className="eyebrow">RECORD ATTENDANCE</div><h2>PICTURE / SCANNER / ID SCANNER</h2><p>Choose an ID scan or face recognition method.</p></div><span className="live-badge"><i /> SYSTEM READY</span></div>
        <div className="tabs"><button className={activeTab === "id" ? "tab selected" : "tab"} onClick={() => setActiveTab("id")}>▤ ID Scan</button><button className={activeTab === "face" ? "tab selected" : "tab"} onClick={() => setActiveTab("face")}>◎ Face Recognition</button></div>
        {activeTab === "id" ? <div className="scan-content">
          {printedIdScanning && <div className="camera-frame id-camera"><video ref={videoRef} autoPlay muted playsInline /><div className="id-guide"><span>I.D. NO.</span></div><span className="scan-camera-label">CENTER THE PRINTED I.D. NO. HERE</span></div>}
          <div className="scan-illustration"><div className="id-card-graphic"><div className="avatar-placeholder">♙</div><div className="fake-lines"><b /><i /><i /></div><div className="card-id-number">I.D. NO. &nbsp; 241-0035</div></div><div className="scan-ring">▤</div></div>
          <div className="scan-form"><h3>Scan your student ID</h3><p>Your card has no barcode. Use the camera to read the printed number, or type the number shown beside I.D. NO.</p>
            <form onSubmit={(e) => { e.preventDefault(); scanId(); }}><label htmlFor="student-id">STUDENT ID NUMBER</label><div className="input-row"><input id="student-id" autoFocus value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder="E.G. 241-0035" /><button className="primary-btn" type="submit">Verify ID <span>→</span></button></div></form>
            <div className="button-row scan-buttons"><button className="primary-btn" onClick={() => printedIdScanning ? printedScanStopRef.current?.() : void startPrintedIdScanner()}>{printedIdScanning ? "STOP CAMERA" : "OPEN CAMERA TO READ ID"}</button></div>
            <div className="hint scan-steps"><strong>HOW TO SCAN</strong><span>1. Allow camera access.</span><span>2. Hold the FRONT of your card steady and fit the whole card in the guide.</span><span>3. Keep the printed I.D. NO. clear and well lit.</span><span>4. Check the number, then tap VERIFY ID.</span><span>Camera not working? Type the number. Add the student to STUDENT INFORMATION first.</span></div>
          </div>
        </div> : <div className="face-content">
          <div className="camera-frame">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder"><div className="face-outline">◯</div><strong>Camera is off</strong><span>Use this for a live face only. The photo printed on an ID card cannot be recognized.</span></div>}{cameraOn && <div className="face-guide" />}</div>
          <div className="face-controls"><h3>Face recognition</h3><p>Face scan is optional. It uses the student’s LIVE face in the camera, not the photo printed on the ID card. Add a student, enroll their face once, then tap RECOGNIZE FACE.</p>
            {!cameraOn ? <button className="primary-btn" onClick={startCamera}>Enable camera <span>→</span></button> : <><div className="button-row"><button className="primary-btn" disabled={faceBusy || !modelsReady} onClick={recognizeFace}>{faceBusy ? "Checking…" : "Recognize face"}</button><button className="secondary-btn" onClick={stopCamera}>Turn off camera</button></div><label htmlFor="enroll-student">ENROLL FACE FOR STUDENT</label><select id="enroll-student" defaultValue="" onChange={(e) => { const s = students.find((x) => x.id === e.target.value); if (s) void enrollFace(s); }}><option value="" disabled>Choose a student to enroll their live face</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.id}{s.descriptor?.length ? " (enrolled)" : ""}</option>)}</select></>}
            <div className="hint">{modelsReady ? "Face models loaded" : "Recognition requires internet access to load AI models."} Face data is kept in this browser only.</div>
          </div>
        </div>}
        <div className={status.toLowerCase().includes("recorded") ? "status-message success" : "status-message"} role="status"><span>ⓘ</span>{status}</div>
      </section>
      <section className="panel" id="students">
        <div className="panel-heading"><div><div className="eyebrow">DIRECTORY</div><h2>STUDENT INFORMATION</h2><p>Manage student profiles and face enrollment.</p></div><button className="primary-btn" onClick={() => setShowAdd((v) => !v)}>＋ Add Student</button></div>
        {showAdd && <form className="add-form" onSubmit={addStudent}><input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="Student ID" required /><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" required /><select value={newCourse} onChange={(e) => setNewCourse(e.target.value)}><option>BS Information Technology</option><option>BS Computer Science</option><option>BS Information Systems</option><option>Other</option></select><select value={newYear} onChange={(e) => setNewYear(e.target.value)}><option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option></select><button className="primary-btn" type="submit">Save student</button></form>}
        <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>STUDENT ID</th><th>COURSE / YEAR</th><th>FACE PROFILE</th><th>ACTION</th></tr></thead><tbody>{students.map((s) => <tr key={s.id}><td><div className="student-cell"><div className="student-avatar">{s.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</div><strong>{s.name}</strong></div></td><td className="mono">{s.id}</td><td>{s.course}<small className="subline">{s.year}</small></td><td>{s.descriptor?.length ? <span className="pill enrolled">✓ Enrolled</span> : <span className="pill not-enrolled">Not enrolled</span>}</td><td><button className="delete-btn" type="button" onClick={() => removeStudent(s)} aria-label={`Delete ${s.name}`}>Delete</button></td></tr>)}</tbody></table>{!students.length && <div className="empty-state">No students yet. Add a student to begin.</div>}</div>
      </section>
      <section className="panel" id="records">
        <div className="panel-heading"><div><div className="eyebrow">ATTENDANCE LOG</div><h2>VIEW ATTENDANCE REPORT</h2><p>Review attendance records and export a report.</p></div><button className="secondary-btn" onClick={exportCsv} disabled={!attendance.length}>↓ Export CSV</button></div>
        <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>DATE / TIME</th><th>METHOD</th><th>STATUS</th></tr></thead><tbody>{attendance.slice(0, 20).map((a, i) => <tr key={a.id + a.date}><td><div className="student-cell"><div className="student-avatar">{a.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</div><div><strong>{a.name}</strong><small className="subline mono">{a.id}</small></div></div></td><td>{a.date}<small className="subline">{a.time}</small></td><td><span className="method-tag">{a.method}</span></td><td><span className="pill enrolled">✓ Recorded</span></td></tr>)}</tbody></table>{!attendance.length && <div className="empty-state"><div className="empty-icon">▧</div><strong>No attendance records yet</strong><span>Scan a student ID or recognize an enrolled face to record attendance.</span></div>}</div>
      </section>
      <footer>STUDENT MONITORING SYSTEM <span>•</span> ID SCANNING & FACE RECOGNITION <span>•</span> DEMO BUILD</footer>
    </section>
  </main>;
}
