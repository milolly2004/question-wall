/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
} from 'firebase/firestore';
import {
  db,
  ClassroomQuestion,
  handleFirestoreError,
  OperationType,
} from './firebase';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import {
  Send,
  CheckCircle2,
  Tv,
  Smartphone,
  Check,
  Edit3,
  Clock,
  Sparkles,
  QrCode,
  ExternalLink,
  Maximize2,
  X,
  Copy,
  Lightbulb,
  Star,
  MessageCircleQuestion,
  HelpCircle,
} from 'lucide-react';

function parseTimestamp(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null) {
    if ('toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    }
    if ('seconds' in raw && typeof (raw as { seconds: number }).seconds === 'number') {
      return new Date((raw as { seconds: number }).seconds * 1000).toISOString();
    }
  }
  return new Date().toISOString();
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 10) return 'Just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Recently';
  }
}

export default function App() {
  // Determine initial view from URL query params
  const [currentView, setCurrentView] = useState<'student' | 'teacher'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      if (viewParam === 'teacher') return 'teacher';
      if (viewParam === 'student') return 'student';
    }
    // Default to student view for phone/students
    return 'student';
  });

  // Firestore real-time questions
  const [questions, setQuestions] = useState<ClassroomQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Student Question Form state
  const [studentQuestionText, setStudentQuestionText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSentSuccess, setIsSentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Teacher answering state
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);

  // QR Code state
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [studentPageUrl, setStudentPageUrl] = useState<string>('');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Filter for teacher dashboard
  const [dashboardFilter, setDashboardFilter] = useState<'all' | 'unanswered' | 'answered'>('all');

  // Sync view switch to URL search params
  const switchView = (view: 'student' | 'teacher') => {
    setCurrentView(view);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', view);
      window.history.replaceState(null, '', url.toString());
    }
  };

  // Generate QR Code that strictly points to Student Question Page
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Construct the direct Student Question Page URL
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'student');
    const fullStudentUrl = url.toString();
    setStudentPageUrl(fullStudentUrl);

    // Generate high-resolution QR code
    QRCode.toDataURL(fullStudentUrl, {
      width: 400,
      margin: 1.5,
      color: {
        dark: '#1e1b4b', // deep indigo for optimal scan contrast
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        setQrCodeDataUrl(dataUrl);
      })
      .catch((err) => {
        console.error('Failed to generate QR Code:', err);
      });
  }, []);

  // Real-time Firestore sync with existing 'questions' collection
  useEffect(() => {
    setIsLoading(true);
    const questionsCollection = collection(db, 'questions');

    const unsubscribe = onSnapshot(
      questionsCollection,
      (snapshot) => {
        const items: ClassroomQuestion[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const hasAnswer = Boolean(data.answer && String(data.answer).trim().length > 0);
          items.push({
            id: docSnap.id,
            question: data.question || '',
            answer: data.answer || '',
            status: hasAnswer ? 'answered' : (data.status === 'answered' ? 'answered' : 'unanswered'),
            createdAt: parseTimestamp(data.createdAt),
            answeredAt: data.answeredAt ? parseTimestamp(data.answeredAt) : undefined,
          });
        });

        // Sort: Newest questions first
        items.sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime() || 0;
          const timeB = new Date(b.createdAt).getTime() || 0;
          return timeB - timeA;
        });

        setQuestions(items);
        setIsLoading(false);
      },
      (error) => {
        console.error('Firestore listener error:', error);
        setIsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'questions');
      }
    );

    return () => unsubscribe();
  }, []);

  // Student Submitting Question
  const handleSendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = studentQuestionText.trim();
    if (!trimmed) {
      setErrorMessage('Please type what you want to ask! ✍️');
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      await addDoc(collection(db, 'questions'), {
        question: trimmed,
        status: 'unanswered',
        createdAt: new Date().toISOString(),
      });

      // Confetti burst for Grade 4 encouragement
      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.65 },
          colors: ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#3b82f6'],
        });
      } catch {
        // Fallback gracefully
      }

      setIsSentSuccess(true);
      setStudentQuestionText('');
    } catch (err) {
      console.error('Failed to submit question:', err);
      handleFirestoreError(err, OperationType.CREATE, 'questions');
      setErrorMessage('Could not send your question. Please try again! ⚠️');
    } finally {
      setIsSending(false);
    }
  };

  // Teacher Saving Answer
  const handleSaveAnswer = async (questionId: string) => {
    const trimmed = answerDraft.trim();
    if (!trimmed) return;

    setIsSavingAnswer(true);
    try {
      const qRef = doc(db, 'questions', questionId);
      await updateDoc(qRef, {
        answer: trimmed,
        status: 'answered',
        answeredAt: new Date().toISOString(),
      });
      setAnsweringId(null);
      setAnswerDraft('');
    } catch (err) {
      console.error('Failed to save answer:', err);
      handleFirestoreError(err, OperationType.UPDATE, `questions/${questionId}`);
    } finally {
      setIsSavingAnswer(false);
    }
  };

  const handleCopyLink = () => {
    if (studentPageUrl) {
      navigator.clipboard.writeText(studentPageUrl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  // Filtered questions for Teacher Dashboard
  const filteredQuestions = questions.filter((q) => {
    if (dashboardFilter === 'unanswered') return q.status === 'unanswered';
    if (dashboardFilter === 'answered') return q.status === 'answered';
    return true;
  });

  return (
    <div className="min-h-screen bg-amber-50/40 text-slate-900 flex flex-col font-sans">
      {/* =========================================================================
          TOP NAVIGATION BAR
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-xs border-b-2 border-amber-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3">
          {/* Logo & Classroom Header */}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-400 border-2 border-amber-500 flex items-center justify-center shadow-xs">
              <span className="text-xl sm:text-2xl" role="img" aria-label="Pin">
                📌
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-display">
                  Question Wall
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                  Grade 4 English
                </span>
              </div>
              <p className="text-xs text-slate-500 font-semibold hidden md:block">
                Real-time classroom question &amp; answer board
              </p>
            </div>
          </div>

          {/* Action Area: Cute "สงสัย? Ask a Question!" button + View Switcher */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Cute "สงสัย? Ask a Question! 💡" Button */}
            <button
              id="ask-question-quick-button"
              type="button"
              onClick={() => {
                switchView('student');
                setIsSentSuccess(false);
              }}
              className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-2xl bg-linear-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 active:scale-95 text-slate-950 font-black text-xs sm:text-sm shadow-sm hover:shadow-md border-2 border-amber-600 transition-all cursor-pointer"
            >
              <Lightbulb className="w-4 h-4 text-amber-950 fill-amber-300" />
              <span className="font-extrabold tracking-wide">
                สงสัย? Ask a Question! 💡
              </span>
            </button>

            {/* View Switcher: Student vs Teacher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-300">
              <button
                id="switch-student-tab"
                type="button"
                onClick={() => switchView('student')}
                className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  currentView === 'student'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Student View</span>
                <span className="sm:hidden">Student</span>
              </button>

              <button
                id="switch-teacher-tab"
                type="button"
                onClick={() => switchView('teacher')}
                className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  currentView === 'teacher'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Teacher Dashboard</span>
                <span className="sm:hidden">Teacher</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* =========================================================================
          MAIN CONTENT AREA
         ========================================================================= */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 md:p-6 flex flex-col">
        {/* =======================================================================
            VIEW 1: REDESIGNED STUDENT QUESTION PAGE (CUTE, GRADE 4 FRIENDLY)
           ======================================================================= */}
        {currentView === 'student' && (
          <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full py-4 sm:py-8">
            {/* Cute Classroom Card Frame */}
            <div className="w-full bg-white rounded-3xl border-3 border-amber-300 p-5 sm:p-8 shadow-md relative overflow-hidden">
              {/* Playful top colored ribbon */}
              <div className="absolute top-0 left-0 right-0 h-3 bg-linear-to-r from-amber-400 via-rose-300 to-sky-400" />

              {/* Header Title Section */}
              <div className="text-center mt-2 mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-amber-100 border-2 border-amber-300 text-3xl mb-3 shadow-xs transform hover:rotate-3 transition-transform">
                  🦉
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight font-display flex items-center justify-center gap-2">
                  <span>Question Wall</span>
                  <span className="text-2xl">✏️</span>
                </h2>
                <p className="text-slate-600 text-sm sm:text-base font-semibold mt-1.5">
                  Have a question in English class? Type it below!
                </p>
              </div>

              {/* SUCCESS CONFIRMATION STATE */}
              {isSentSuccess ? (
                <div id="student-success-box" className="py-4 text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
                  <div className="w-20 h-20 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto border-3 border-amber-300 shadow-sm animate-bounce">
                    <Star className="w-12 h-12 fill-amber-400 text-amber-500" />
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-2xl sm:text-3xl font-black text-slate-900 font-display">
                      Your question has been sent! ⭐
                    </h3>
                    <p className="text-slate-600 text-base font-medium px-2">
                      Look up at the classroom screen! Your teacher will see it and answer soon. 🎈
                    </p>
                  </div>

                  {/* Redesigned "สงสัย? Ask a Question! 💡" Button */}
                  <div className="pt-3">
                    <button
                      id="student-ask-another-button"
                      type="button"
                      onClick={() => {
                        setIsSentSuccess(false);
                        setStudentQuestionText('');
                      }}
                      className="w-full py-4 px-6 rounded-2xl bg-linear-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 active:scale-98 font-black text-slate-950 text-lg sm:text-xl shadow-md border-2 border-amber-600 transition-all cursor-pointer flex items-center justify-center gap-2.5"
                    >
                      <Lightbulb className="w-6 h-6 text-amber-950 fill-amber-300" />
                      <span>สงสัย? Ask a Question! 💡</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* QUESTION INPUT FORM */
                <form onSubmit={handleSendQuestion} className="space-y-4 text-left">
                  {errorMessage && (
                    <div className="p-3 bg-rose-50 border-2 border-rose-200 text-rose-800 text-sm font-bold rounded-2xl flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="student-question-textarea"
                      className="block text-lg sm:text-xl font-black text-slate-900 mb-2 font-display flex items-center gap-2"
                    >
                      <span>What do you want to ask?</span>
                      <span className="text-base">💭</span>
                    </label>
                    <textarea
                      id="student-question-textarea"
                      rows={4}
                      required
                      value={studentQuestionText}
                      onChange={(e) => setStudentQuestionText(e.target.value)}
                      placeholder="Type your question here..."
                      className="w-full rounded-2xl border-2 border-amber-300 bg-amber-50/30 p-4 text-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white focus:ring-4 focus:ring-amber-200 transition-all resize-y font-medium"
                    />
                  </div>

                  {/* Main "Send Question" Button */}
                  <button
                    id="send-question-main-button"
                    type="submit"
                    disabled={isSending || !studentQuestionText.trim()}
                    className="w-full py-4 px-6 rounded-2xl bg-linear-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 active:scale-98 font-black text-white text-xl sm:text-2xl shadow-md hover:shadow-lg border-2 border-emerald-700 transition-all cursor-pointer flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-6 h-6" />
                    <span>{isSending ? 'Sending... ⏳' : 'Send Question 🚀'}</span>
                  </button>

                  <div className="pt-2 text-center">
                    <p className="text-xs text-slate-500 font-semibold inline-flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                      <span>🔒</span>
                      <span>No login needed • Anonymous question</span>
                    </p>
                  </div>
                </form>
              )}
            </div>

            {/* Quick helper tip for students */}
            <div className="mt-4 text-center text-xs text-slate-500 font-semibold flex items-center gap-1.5 justify-center">
              <span>💡</span>
              <span>Ask anything you are unsure about in today&apos;s English lesson!</span>
            </div>
          </div>
        )}

        {/* =======================================================================
            VIEW 2: REDESIGNED TEACHER DASHBOARD (PROJECTOR-OPTIMIZED GRID)
           ======================================================================= */}
        {currentView === 'teacher' && (
          <div className="space-y-4 sm:space-y-5">
            {/* TOP DASHBOARD CONTROL & QR CODE PROJECTOR BANNER */}
            <div className="bg-white rounded-3xl border-2 border-indigo-200 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Left Column: Title, Live Status, Filter Tabs */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>LIVE REAL-TIME</span>
                  </span>
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200">
                    Projector View (2–3 Questions Across)
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight font-display">
                  Classroom Question Board
                </h2>

                {/* Filter Pills / Status Counts */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDashboardFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                      dashboardFilter === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                    }`}
                  >
                    All Questions ({questions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardFilter('unanswered')}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                      dashboardFilter === 'unanswered'
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300'
                    }`}
                  >
                    Waiting for Answer ({questions.filter((q) => q.status === 'unanswered').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardFilter('answered')}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                      dashboardFilter === 'answered'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border border-emerald-300'
                    }`}
                  >
                    Answered ({questions.filter((q) => q.status === 'answered').length})
                  </button>
                </div>
              </div>

              {/* Right Column: Prominent QR Code for Student Question Page */}
              <div
                id="teacher-qr-card"
                className="bg-amber-50/80 border-2 border-amber-300 rounded-2xl p-3 sm:p-3.5 flex items-center gap-3.5 shrink-0 shadow-xs hover:border-amber-400 transition-colors"
              >
                {/* QR Code Graphic */}
                {qrCodeDataUrl ? (
                  <div
                    onClick={() => setIsQrModalOpen(true)}
                    className="bg-white p-1.5 rounded-xl border border-amber-300 shadow-xs cursor-pointer group relative"
                    title="Click to expand QR Code for projector"
                  >
                    <img
                      src={qrCodeDataUrl}
                      alt="Scan to ask a question"
                      className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-lg group-hover:opacity-90 transition-opacity"
                    />
                    <div className="absolute inset-0 bg-slate-900/10 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Maximize2 className="w-5 h-5 text-slate-800" />
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 bg-white rounded-xl border border-amber-300 flex items-center justify-center">
                    <QrCode className="w-10 h-10 text-amber-400 animate-pulse" />
                  </div>
                )}

                {/* QR Code Labels & Actions */}
                <div className="space-y-1">
                  <p className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-1.5">
                    <span>Scan to ask a question! 📱</span>
                  </p>
                  <p className="text-xs text-slate-600 font-semibold">
                    Opens the Student Question page
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsQrModalOpen(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-200 hover:bg-amber-300 text-slate-900 transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-3 h-3" />
                      <span>Enlarge QR</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copyFeedback ? 'Copied! ✓' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* QUESTIONS CONTENT: COMPACT RESPONSIVE GRID (2–3 CARDS ACROSS) */}
            {isLoading && (
              <div className="py-16 text-center bg-white rounded-3xl border-2 border-slate-200">
                <div className="w-10 h-10 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-slate-600 font-bold text-lg">Connecting to Question Wall...</p>
              </div>
            )}

            {!isLoading && filteredQuestions.length === 0 && (
              <div className="py-16 px-6 text-center bg-white rounded-3xl border-2 border-dashed border-slate-300">
                <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl mx-auto mb-3">
                  ⏳
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-1.5 font-display">
                  {dashboardFilter === 'all'
                    ? 'Waiting for student questions...'
                    : `No ${dashboardFilter} questions right now`}
                </h3>
                <p className="text-slate-600 max-w-md mx-auto text-sm sm:text-base font-medium">
                  Students can scan the QR code above or tap &ldquo;สงสัย? Ask a Question! 💡&rdquo; to send a question directly to the screen!
                </p>
              </div>
            )}

            {/* RESPONSIVE GRID OF COMPACT QUESTION CARDS */}
            {!isLoading && filteredQuestions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                {filteredQuestions.map((q, index) => {
                  const isAnswered = q.status === 'answered' && Boolean(q.answer && q.answer.trim());
                  const isEditingThis = answeringId === q.id;

                  return (
                    <div
                      key={q.id}
                      id={`teacher-card-${q.id}`}
                      className={`rounded-2xl border-2 p-3.5 sm:p-4 bg-white flex flex-col justify-between transition-all shadow-xs hover:shadow-md ${
                        index === 0 && dashboardFilter === 'all'
                          ? 'border-indigo-400 ring-2 ring-indigo-200/70 bg-linear-to-b from-indigo-50/30 to-white'
                          : isAnswered
                          ? 'border-emerald-300 bg-emerald-50/15'
                          : 'border-amber-300 bg-amber-50/15'
                      }`}
                    >
                      <div>
                        {/* Compact Card Header */}
                        <div className="flex items-center justify-between gap-1.5 mb-2">
                          <div className="flex items-center gap-1.5">
                            {index === 0 && dashboardFilter === 'all' && (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-indigo-600 text-white tracking-wider uppercase flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                <span>New</span>
                              </span>
                            )}

                            {isAnswered ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <Check className="w-3 h-3 text-emerald-700" />
                                <span>Answered</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                                <Clock className="w-3 h-3 text-amber-700" />
                                <span>Needs Answer</span>
                              </span>
                            )}
                          </div>

                          <span className="text-[11px] font-semibold text-slate-400">
                            {formatRelativeTime(q.createdAt)}
                          </span>
                        </div>

                        {/* Student's Question (Clear and readable on projector) */}
                        <div className="my-1.5">
                          <p className="text-base sm:text-lg font-extrabold text-slate-950 leading-snug break-words">
                            {q.question}
                          </p>
                        </div>

                        {/* Teacher's Answer Box (if answered and not currently editing) */}
                        {isAnswered && !isEditingThis && (
                          <div className="mt-2.5 p-2.5 sm:p-3 rounded-xl bg-emerald-50/90 border border-emerald-200 text-slate-900">
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[11px] font-black text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Answer:</span>
                              </span>

                              <button
                                type="button"
                                onClick={() => {
                                  setAnsweringId(q.id);
                                  setAnswerDraft(q.answer || '');
                                }}
                                className="text-[11px] font-bold text-slate-600 hover:text-indigo-600 flex items-center gap-0.5 hover:underline cursor-pointer"
                              >
                                <Edit3 className="w-2.5 h-2.5" />
                                <span>Edit</span>
                              </button>
                            </div>

                            <p className="text-sm sm:text-base font-bold text-slate-900 whitespace-pre-line leading-relaxed">
                              {q.answer}
                            </p>
                          </div>
                        )}

                        {/* Inline Answer Form (when teacher clicks Answer or Edit) */}
                        {isEditingThis && (
                          <div className="mt-2.5 p-2.5 rounded-xl bg-slate-50 border-2 border-indigo-300 space-y-2">
                            <label
                              htmlFor={`answer-input-${q.id}`}
                              className="block text-xs font-black text-indigo-950"
                            >
                              Type teacher&apos;s answer:
                            </label>
                            <textarea
                              id={`answer-input-${q.id}`}
                              rows={3}
                              autoFocus
                              value={answerDraft}
                              onChange={(e) => setAnswerDraft(e.target.value)}
                              placeholder="Type the answer clearly for students..."
                              className="w-full rounded-lg border-2 border-slate-300 p-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 resize-y"
                            />

                            <div className="flex items-center justify-end gap-1.5 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setAnsweringId(null);
                                  setAnswerDraft('');
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                id={`save-answer-${q.id}`}
                                type="button"
                                disabled={isSavingAnswer || !answerDraft.trim()}
                                onClick={() => handleSaveAnswer(q.id)}
                                className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                              >
                                {isSavingAnswer ? 'Posting...' : 'Post Answer'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Card Footer: "Answer" button if not answered yet and not currently editing */}
                      {!isAnswered && !isEditingThis && (
                        <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end">
                          <button
                            id={`answer-button-${q.id}`}
                            type="button"
                            onClick={() => {
                              setAnsweringId(q.id);
                              setAnswerDraft('');
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs sm:text-sm shadow-xs transition-all cursor-pointer flex items-center gap-1 hover:scale-102"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Answer Question</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* =========================================================================
          LARGE FULLSCREEN/POPUP QR CODE MODAL FOR CLASSROOM PROJECTOR
         ========================================================================= */}
      {isQrModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          onClick={() => setIsQrModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border-4 border-amber-400 p-6 sm:p-8 max-w-md w-full text-center shadow-2xl relative animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-xs">
                <span>📱 PROJECTOR SCAN CODE</span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 font-display">
                Scan to ask a question! 📱
              </h3>

              <p className="text-slate-600 text-sm sm:text-base font-semibold">
                Point your phone camera here to open the Student Question page:
              </p>

              {/* Large Crisp QR Code */}
              {qrCodeDataUrl && (
                <div className="p-3 bg-white border-3 border-amber-300 rounded-2xl inline-block shadow-sm">
                  <img
                    src={qrCodeDataUrl}
                    alt="Student Question Page QR Code"
                    className="w-64 h-64 sm:w-72 sm:h-72 object-contain rounded-xl mx-auto"
                  />
                </div>
              )}

              {/* URL and Copy Link button */}
              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-500 font-black text-slate-950 text-sm shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copyFeedback ? 'Copied Student Link! ✓' : 'Copy Student Page Link'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(false)}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 text-xs transition-colors cursor-pointer"
                >
                  Close Screen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Very Simple Classroom Footer */}
      <footer className="py-3 px-4 text-center text-xs text-slate-500 bg-white/80 border-t border-amber-200">
        Grade 4 English • Question Wall • Real-Time Classroom Q&amp;A
      </footer>
    </div>
  );
}
