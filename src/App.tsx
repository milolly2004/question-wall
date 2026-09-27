/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  updateDoc,
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
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  Heart,
  HelpCircle,
  Lightbulb,
  Maximize2,
  QrCode,
  Send,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Tv,
  X,
} from 'lucide-react';

type View = 'student' | 'teacher';
type Filter = 'all' | 'unanswered' | 'answered';

type Animal = {
  emoji: string;
  name: string;
  bg: string;
  border: string;
};

const ANIMALS: Animal[] = [
  { emoji: '🐱', name: 'Cat', bg: 'bg-rose-100', border: 'border-rose-300' },
  { emoji: '🐶', name: 'Dog', bg: 'bg-amber-100', border: 'border-amber-300' },
  { emoji: '🐰', name: 'Bunny', bg: 'bg-pink-100', border: 'border-pink-300' },
  { emoji: '🐻', name: 'Bear', bg: 'bg-orange-100', border: 'border-orange-300' },
  { emoji: '🐼', name: 'Panda', bg: 'bg-slate-100', border: 'border-slate-300' },
  { emoji: '🦊', name: 'Fox', bg: 'bg-orange-100', border: 'border-orange-300' },
  { emoji: '🐸', name: 'Frog', bg: 'bg-green-100', border: 'border-green-300' },
  { emoji: '🐨', name: 'Koala', bg: 'bg-sky-100', border: 'border-sky-300' },
  { emoji: '🐯', name: 'Tiger', bg: 'bg-yellow-100', border: 'border-yellow-300' },
  { emoji: '🐵', name: 'Monkey', bg: 'bg-yellow-100', border: 'border-yellow-300' },
  { emoji: '🐹', name: 'Hamster', bg: 'bg-pink-100', border: 'border-pink-300' },
  { emoji: '🦁', name: 'Lion', bg: 'bg-yellow-100', border: 'border-yellow-300' },
];

const DEFAULT_ANIMAL = ANIMALS[0];

function getOwnerId(): string {
  const key = 'question-wall-owner-id';

  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'anonymous-device';
  }
}

function parseTimestamp(raw: unknown): string {
  if (!raw) return new Date().toISOString();

  if (typeof raw === 'string') return raw;

  if (typeof raw === 'object' && raw !== null) {
    if (
      'toDate' in raw &&
      typeof (raw as { toDate?: () => Date }).toDate === 'function'
    ) {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    }

    if (
      'seconds' in raw &&
      typeof (raw as { seconds?: number }).seconds === 'number'
    ) {
      return new Date(
        (raw as { seconds: number }).seconds * 1000
      ).toISOString();
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

    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Recently';
  }
}

function animalInfo(emoji?: string): Animal {
  return ANIMALS.find((animal) => animal.emoji === emoji) ?? DEFAULT_ANIMAL;
}

export default function App() {
  const ownerId = useMemo(() => getOwnerId(), []);

  const [currentView, setCurrentView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');

      if (view === 'teacher') return 'teacher';
      if (view === 'student') return 'student';
    }

    return 'student';
  });

  const [questions, setQuestions] = useState<ClassroomQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [studentQuestionText, setStudentQuestionText] = useState('');
  const [selectedAnimal, setSelectedAnimal] = useState<Animal>(DEFAULT_ANIMAL);
  const [isSending, setIsSending] = useState(false);
  const [isSentSuccess, setIsSentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);

  const [dashboardFilter, setDashboardFilter] = useState<Filter>('all');

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [studentPageUrl, setStudentPageUrl] = useState('');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const switchView = (view: View) => {
    setCurrentView(view);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', view);
      window.history.replaceState(null, '', url.toString());
    }
  };

  /*
   * QR CODE
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    url.searchParams.set('view', 'student');

    const fullStudentUrl = url.toString();

    setStudentPageUrl(fullStudentUrl);

    QRCode.toDataURL(fullStudentUrl, {
      width: 500,
      margin: 2,
      color: {
        dark: '#253047',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then(setQrCodeDataUrl)
      .catch((error) => {
        console.error('Failed to generate QR Code:', error);
      });
  }, []);

  /*
   * FIRESTORE REAL-TIME LISTENER
   */
  useEffect(() => {
    setIsLoading(true);

    const questionsCollection = collection(db, 'questions');

    const unsubscribe = onSnapshot(
      questionsCollection,
      (snapshot) => {
        const items: ClassroomQuestion[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();

          const hasAnswer =
            Boolean(data.answer) &&
            String(data.answer).trim().length > 0;

          items.push({
            id: docSnap.id,
            question: data.question || '',
            answer: data.answer || '',
            status: hasAnswer
              ? 'answered'
              : data.status === 'answered'
              ? 'answered'
              : 'unanswered',
            createdAt: parseTimestamp(data.createdAt),
            answeredAt: data.answeredAt
              ? parseTimestamp(data.answeredAt)
              : undefined,

            // New fields
            animal: data.animal || '🐱',
            ownerId: data.ownerId || '',
            helpfulCount:
              typeof data.helpfulCount === 'number'
                ? data.helpfulCount
                : 0,
          } as ClassroomQuestion);
        });

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

        handleFirestoreError(
          error,
          OperationType.LIST,
          'questions'
        );
      }
    );

    return () => unsubscribe();
  }, []);

  /*
   * SEND QUESTION
   */
  const handleSendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = studentQuestionText.trim();

    if (!trimmed) {
      setErrorMessage('Please type your question first! 💭');
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      await addDoc(collection(db, 'questions'), {
        question: trimmed,
        status: 'unanswered',
        createdAt: new Date().toISOString(),

        animal: selectedAnimal.emoji,
        ownerId,

        helpfulCount: 0,
      });

      try {
        confetti({
          particleCount: 70,
          spread: 70,
          origin: { y: 0.65 },
          colors: [
            '#ff8fab',
            '#ffb703',
            '#7bdff2',
            '#95d5b2',
            '#b8a1ff',
          ],
        });
      } catch {
        // Animation is optional.
      }

      setIsSentSuccess(true);
      setStudentQuestionText('');
    } catch (error) {
      console.error('Failed to submit question:', error);

      handleFirestoreError(
        error,
        OperationType.CREATE,
        'questions'
      );

      setErrorMessage(
        'Oops! Your question could not be sent. Please try again. 🥺'
      );
    } finally {
      setIsSending(false);
    }
  };

  /*
   * TEACHER ANSWER
   */
  const handleSaveAnswer = async (questionId: string) => {
    const trimmed = answerDraft.trim();

    if (!trimmed) return;

    setIsSavingAnswer(true);

    try {
      await updateDoc(doc(db, 'questions', questionId), {
        answer: trimmed,
        status: 'answered',
        answeredAt: new Date().toISOString(),
      });

      setAnsweringId(null);
      setAnswerDraft('');
    } catch (error) {
      console.error('Failed to save answer:', error);

      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `questions/${questionId}`
      );
    } finally {
      setIsSavingAnswer(false);
    }
  };

  /*
   * HELPFUL / WONDERING
   */
  const handleWonderSame = async (questionId: string) => {
    const storageKey = `question-wall-liked-${questionId}`;

    try {
      if (localStorage.getItem(storageKey) === 'true') {
        return;
      }

      await updateDoc(doc(db, 'questions', questionId), {
        helpfulCount: increment(1),
      });

      localStorage.setItem(storageKey, 'true');
    } catch (error) {
      console.error('Failed to update wondering count:', error);

      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `questions/${questionId}`
      );
    }
  };

  /*
   * DELETE ONE QUESTION
   */
  const handleDeleteQuestion = async (questionId: string) => {
    try {
      await deleteDoc(doc(db, 'questions', questionId));

      setConfirmDeleteId(null);

      if (answeringId === questionId) {
        setAnsweringId(null);
        setAnswerDraft('');
      }
    } catch (error) {
      console.error('Failed to delete question:', error);

      handleFirestoreError(
        error,
        OperationType.DELETE,
        `questions/${questionId}`
      );
    }
  };

  /*
   * CLEAR ALL QUESTIONS
   */
  const handleClearAllQuestions = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'questions'));

      await Promise.all(
        snapshot.docs.map((questionDoc) =>
          deleteDoc(doc(db, 'questions', questionDoc.id))
        )
      );

      setConfirmClearAll(false);
      setAnsweringId(null);
      setAnswerDraft('');
    } catch (error) {
      console.error('Failed to clear questions:', error);

      handleFirestoreError(
        error,
        OperationType.DELETE,
        'questions'
      );
    }
  };

  /*
   * COPY STUDENT LINK
   */
  const handleCopyLink = async () => {
    if (!studentPageUrl) return;

    try {
      await navigator.clipboard.writeText(studentPageUrl);

      setCopyFeedback(true);

      window.setTimeout(() => {
        setCopyFeedback(false);
      }, 2000);
    } catch {
      setCopyFeedback(false);
    }
  };

  const filteredQuestions = questions.filter((question) => {
    if (dashboardFilter === 'unanswered') {
      return question.status === 'unanswered';
    }

    if (dashboardFilter === 'answered') {
      return question.status === 'answered';
    }

    return true;
  });

  const myQuestions = questions.filter(
    (question) => question.ownerId === ownerId
  );

  return (
    <div className="min-h-screen bg-[#fff9f2] text-slate-900 flex flex-col font-sans relative overflow-hidden">

      {/* Decorative animals */}
      <div className="pointer-events-none fixed -left-5 top-24 text-5xl opacity-20 rotate-[-12deg]">
        🐰
      </div>

      <div className="pointer-events-none fixed -right-4 top-40 text-6xl opacity-20 rotate-12">
        🦊
      </div>

      <div className="pointer-events-none fixed left-8 bottom-12 text-5xl opacity-15">
        🐼
      </div>

      <div className="pointer-events-none fixed right-8 bottom-16 text-5xl opacity-15">
        🐸
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b-2 border-pink-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-pink-100 border-2 border-pink-300 flex items-center justify-center text-2xl shadow-sm">
              🐾
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">
                  Question Wall
                </h1>

                <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 border border-sky-200 text-xs font-black">
                  Grade 4 English
                </span>
              </div>

              <p className="hidden md:block text-xs text-slate-500 font-semibold">
                Ask • Wonder • Learn together 🐾
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">

            <button
              type="button"
              onClick={() => {
                switchView('student');
                setIsSentSuccess(false);
              }}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-2xl bg-pink-400 hover:bg-pink-500 text-white font-black text-xs sm:text-sm shadow-sm border-2 border-pink-500 transition-all active:scale-95"
            >
              <Lightbulb className="w-4 h-4" />
              <span className="hidden sm:inline">
                Ask a Question
              </span>
              <span className="sm:hidden">Ask</span>
            </button>

            <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">

              <button
                type="button"
                onClick={() => switchView('student')}
                className={`px-2.5 sm:px-3 py-2 rounded-xl text-xs font-black transition-all ${
                  currentView === 'student'
                    ? 'bg-white shadow-sm text-pink-600'
                    : 'text-slate-500'
                }`}
              >
                <Smartphone className="w-4 h-4 inline mr-1" />
                <span className="hidden sm:inline">
                  Student
                </span>
              </button>

              <button
                type="button"
                onClick={() => switchView('teacher')}
                className={`px-2.5 sm:px-3 py-2 rounded-xl text-xs font-black transition-all ${
                  currentView === 'teacher'
                    ? 'bg-white shadow-sm text-indigo-600'
                    : 'text-slate-500'
                }`}
              >
                <Tv className="w-4 h-4 inline mr-1" />
                <span className="hidden sm:inline">
                  Teacher
                </span>
              </button>

            </div>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 relative z-10">

        {/* =========================================================
            STUDENT VIEW
        ========================================================= */}
        {currentView === 'student' && (
          <div className="max-w-xl mx-auto py-5 sm:py-10">

            <div className="bg-white rounded-[2rem] border-2 border-pink-200 shadow-xl overflow-hidden">

              {/* Animal banner */}
              <div className="h-4 bg-gradient-to-r from-pink-300 via-yellow-200 via-sky-200 to-green-200" />

              <div className="p-5 sm:p-8">

                <div className="text-center mb-7">

                  <div className="flex justify-center gap-2 text-4xl mb-3">
                    <span>🐱</span>
                    <span>🐰</span>
                    <span>🐻</span>
                    <span>🦊</span>
                    <span>🐼</span>
                  </div>

                  <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
                    Question Wall 💭
                  </h2>

                  <p className="mt-2 text-slate-500 font-semibold">
                    What are you wondering about?
                  </p>

                </div>

                {isSentSuccess ? (
                  <div className="text-center py-5">

                    <div className="text-7xl mb-5 animate-bounce">
                      {selectedAnimal.emoji}
                    </div>

                    <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 border-2 border-green-200 px-4 py-2 rounded-full font-black mb-4">
                      <CheckCircle2 className="w-5 h-5" />
                      Question sent!
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black mb-2">
                      Great job! 🌟
                    </h3>

                    <p className="text-slate-500 font-semibold mb-6">
                      Your teacher can see your question on the Question Wall.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setIsSentSuccess(false);
                        setStudentQuestionText('');
                      }}
                      className="w-full py-4 rounded-2xl bg-pink-400 hover:bg-pink-500 text-white font-black text-lg border-2 border-pink-500 shadow-sm transition-all active:scale-95"
                    >
                      Ask Another Question 💭
                    </button>

                  </div>
                ) : (
                  <form
                    onSubmit={handleSendQuestion}
                    className="space-y-6"
                  >

                    {errorMessage && (
                      <div className="bg-rose-50 border-2 border-rose-200 text-rose-700 rounded-2xl p-3 font-bold text-sm">
                        {errorMessage}
                      </div>
                    )}

                    {/* ANIMAL SELECTOR */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-lg font-black">
                          Choose your animal 🐾
                        </label>

                        <span className="text-xs text-slate-400 font-bold">
                          Pick one!
                        </span>
                      </div>

                      <div className="grid grid-cols-6 gap-2">
                        {ANIMALS.map((animal) => {
                          const selected =
                            selectedAnimal.emoji === animal.emoji;

                          return (
                            <button
                              key={animal.emoji}
                              type="button"
                              aria-label={`Choose ${animal.name}`}
                              onClick={() => setSelectedAnimal(animal)}
                              className={`aspect-square rounded-2xl border-2 flex items-center justify-center text-3xl transition-all ${
                                selected
                                  ? `${animal.bg} ${animal.border} scale-110 shadow-md ring-2 ring-pink-200`
                                  : 'bg-slate-50 border-slate-200 hover:scale-105 hover:bg-white'
                              }`}
                            >
                              {animal.emoji}
                            </button>
                          );
                        })}
                      </div>

                      <p className="text-center text-sm text-slate-500 font-bold mt-3">
                        You chose {selectedAnimal.emoji}{' '}
                        {selectedAnimal.name}! ✨
                      </p>
                    </div>

                    {/* QUESTION */}
                    <div>
                      <label
                        htmlFor="student-question-textarea"
                        className="block text-lg font-black mb-2"
                      >
                        What do you want to ask? 💭
                      </label>

                      <textarea
                        id="student-question-textarea"
                        rows={4}
                        required
                        value={studentQuestionText}
                        onChange={(e) =>
                          setStudentQuestionText(e.target.value)
                        }
                        placeholder="Type your question here..."
                        className="w-full rounded-2xl border-2 border-sky-200 bg-sky-50/40 p-4 text-lg font-medium resize-none focus:outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      />
                    </div>

                    {/* SEND */}
                    <button
                      id="send-question-main-button"
                      type="submit"
                      disabled={
                        isSending ||
                        !studentQuestionText.trim()
                      }
                      className="w-full py-4 rounded-2xl bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-500 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xl shadow-md border-2 border-blue-500 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Send className="w-6 h-6" />
                      {isSending
                        ? 'Sending...'
                        : 'Send Question 🚀'}
                    </button>

                    <div className="text-center">
                      <span className="inline-flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 text-slate-500 px-3 py-1.5 rounded-full font-semibold">
                        🔒 No login needed
                      </span>
                    </div>

                  </form>
                )}

              </div>
            </div>

            {/* My questions */}
            {myQuestions.length > 0 && (
              <div className="mt-6">

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🐾</span>
                  <h3 className="font-black text-lg">
                    My Questions
                  </h3>
                </div>

                <div className="space-y-3">

                  {myQuestions.map((question) => {
                    const animal = animalInfo(question.animal);

                    return (
                      <div
                        key={question.id}
                        className="bg-white border-2 border-slate-100 rounded-2xl p-4 shadow-sm"
                      >
                        <div className="flex gap-3">

                          <div
                            className={`w-12 h-12 shrink-0 rounded-2xl ${animal.bg} border-2 ${animal.border} flex items-center justify-center text-2xl`}
                          >
                            {animal.emoji}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="font-bold break-words">
                              {question.question}
                            </p>

                            <div className="flex items-center gap-2 mt-2 text-xs">
                              {question.status === 'answered' ? (
                                <span className="text-green-600 font-black">
                                  ✓ Answered
                                </span>
                              ) : (
                                <span className="text-amber-600 font-black">
                                  ⏳ Waiting for answer
                                </span>
                              )}

                              {question.helpfulCount > 0 && (
                                <span className="text-pink-500 font-black">
                                  💗 {question.helpfulCount}
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteId(question.id)
                            }
                            className="self-start p-2 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            aria-label="Delete question"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                        </div>

                        {question.answer && (
                          <div className="mt-3 ml-15 bg-green-50 border border-green-200 rounded-xl p-3">
                            <p className="text-xs font-black text-green-700 mb-1">
                              👩‍🏫 Teacher's Answer
                            </p>

                            <p className="font-semibold text-sm whitespace-pre-line">
                              {question.answer}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}

                </div>
              </div>
            )}

          </div>
        )}

        {/* =========================================================
            TEACHER VIEW
        ========================================================= */}
        {currentView === 'teacher' && (
          <div className="space-y-5">

            {/* TOP */}
            <div className="bg-white rounded-[2rem] border-2 border-indigo-100 shadow-md p-5">

              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">

                <div>

                  <div className="flex flex-wrap gap-2 mb-3">

                    <span className="inline-flex items-center gap-2 bg-green-100 text-green-700 border border-green-200 px-3 py-1 rounded-full text-xs font-black">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      LIVE
                    </span>

                    <span className="bg-pink-100 text-pink-700 border border-pink-200 px-3 py-1 rounded-full text-xs font-black">
                      🐾 Animal Question Wall
                    </span>

                  </div>

                  <h2 className="text-2xl sm:text-3xl font-black">
                    Classroom Question Board
                  </h2>

                  <p className="text-slate-500 font-semibold mt-1">
                    See what your students are wondering about.
                  </p>

                  {/* FILTERS */}
                  <div className="flex flex-wrap gap-2 mt-4">

                    <button
                      type="button"
                      onClick={() => setDashboardFilter('all')}
                      className={`px-3 py-2 rounded-xl text-xs font-black ${
                        dashboardFilter === 'all'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      All ({questions.length})
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setDashboardFilter('unanswered')
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-black ${
                        dashboardFilter === 'unanswered'
                          ? 'bg-amber-500 text-white'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      Waiting (
                      {
                        questions.filter(
                          (q) => q.status === 'unanswered'
                        ).length
                      }
                      )
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setDashboardFilter('answered')
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-black ${
                        dashboardFilter === 'answered'
                          ? 'bg-green-600 text-white'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      Answered (
                      {
                        questions.filter(
                          (q) => q.status === 'answered'
                        ).length
                      }
                      )
                    </button>

                  </div>
                </div>

                {/* QR */}
                <div className="bg-gradient-to-br from-pink-50 to-sky-50 border-2 border-pink-200 rounded-3xl p-4 flex items-center gap-4">

                  {qrCodeDataUrl ? (
                    <button
                      type="button"
                      onClick={() => setIsQrModalOpen(true)}
                      className="bg-white p-2 rounded-2xl border-2 border-pink-200 shadow-sm"
                    >
                      <img
                        src={qrCodeDataUrl}
                        alt="Scan to ask a question"
                        className="w-24 h-24 object-contain"
                      />
                    </button>
                  ) : (
                    <div className="w-24 h-24 bg-white rounded-2xl flex items-center justify-center">
                      <QrCode className="w-10 h-10 text-pink-300" />
                    </div>
                  )}

                  <div>
                    <p className="font-black">
                      Scan to ask! 📱
                    </p>

                    <p className="text-xs text-slate-500 font-semibold mt-1">
                      Students choose an animal before asking.
                    </p>

                    <div className="flex gap-2 mt-3">

                      <button
                        type="button"
                        onClick={() => setIsQrModalOpen(true)}
                        className="px-3 py-2 rounded-xl bg-white border border-pink-200 text-xs font-black"
                      >
                        Enlarge
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black"
                      >
                        <Copy className="w-3 h-3 inline mr-1" />
                        {copyFeedback
                          ? 'Copied!'
                          : 'Copy Link'}
                      </button>

                    </div>
                  </div>
                </div>

              </div>

              {/* CLEAR ALL */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">

                <button
                  type="button"
                  disabled={questions.length === 0}
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border-2 border-rose-200 text-rose-600 font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear All Questions
                </button>

              </div>

            </div>

            {/* QUESTIONS */}
            {isLoading && (
              <div className="bg-white rounded-3xl p-16 text-center border-2 border-slate-100">
                <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-3" />
                <p className="font-black text-slate-500">
                  Connecting to Question Wall...
                </p>
              </div>
            )}

            {!isLoading &&
              filteredQuestions.length === 0 && (
                <div className="bg-white rounded-3xl p-16 text-center border-2 border-dashed border-pink-200">
                  <div className="text-6xl mb-4">
                    🐾
                  </div>

                  <h3 className="text-2xl font-black">
                    No questions yet!
                  </h3>

                  <p className="text-slate-500 font-semibold mt-2">
                    Students can scan the QR code and send their questions.
                  </p>
                </div>
              )}

            {!isLoading &&
              filteredQuestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

                  {filteredQuestions.map((question) => {
                    const animal = animalInfo(question.animal);

                    const isAnswered =
                      question.status === 'answered' &&
                      Boolean(
                        question.answer &&
                          question.answer.trim()
                      );

                    const isEditing =
                      answeringId === question.id;

                    const isPopular =
                      (question.helpfulCount || 0) > 0;

                    return (
                      <div
                        key={question.id}
                        className={`bg-white rounded-3xl border-2 p-4 shadow-sm transition-all hover:shadow-md ${
                          isPopular
                            ? 'border-pink-300 ring-2 ring-pink-100'
                            : isAnswered
                            ? 'border-green-200'
                            : 'border-amber-200'
                        }`}
                      >

                        {/* CARD HEADER */}
                        <div className="flex items-start justify-between gap-3">

                          <div className="flex items-center gap-3">

                            <div
                              className={`w-14 h-14 rounded-2xl ${animal.bg} border-2 ${animal.border} flex items-center justify-center text-3xl`}
                            >
                              {animal.emoji}
                            </div>

                            <div>
                              <div className="flex flex-wrap gap-1.5">

                                {isPopular && (
                                  <span className="inline-flex items-center gap-1 bg-pink-100 text-pink-600 border border-pink-200 px-2 py-1 rounded-full text-[10px] font-black">
                                    <Heart className="w-3 h-3 fill-pink-400" />
                                    Wondering Together
                                  </span>
                                )}

                                {isAnswered ? (
                                  <span className="bg-green-100 text-green-700 border border-green-200 px-2 py-1 rounded-full text-[10px] font-black">
                                    ✓ Answered
                                  </span>
                                ) : (
                                  <span className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-1 rounded-full text-[10px] font-black">
                                    ⏳ Waiting
                                  </span>
                                )}

                              </div>

                              <p className="text-[11px] text-slate-400 font-semibold mt-1">
                                {formatRelativeTime(
                                  question.createdAt
                                )}
                              </p>
                            </div>

                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteId(question.id)
                            }
                            className="p-2 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                            aria-label="Delete question"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                        </div>

                        {/* QUESTION */}
                        <div className="mt-4 bg-slate-50 rounded-2xl p-4">

                          <p className="text-lg font-black leading-snug break-words">
                            {question.question}
                          </p>

                          <button
                            type="button"
                            onClick={() =>
                              handleWonderSame(question.id)
                            }
                            className="mt-3 inline-flex items-center gap-2 bg-pink-100 hover:bg-pink-200 text-pink-600 border border-pink-200 px-3 py-2 rounded-xl text-xs font-black transition-all active:scale-95"
                          >
                            <Heart className="w-4 h-4" />
                            <span>
                              {question.helpfulCount || 0}{' '}
                              students are wondering too
                            </span>
                          </button>

                        </div>

                        {/* ANSWER */}
                        {isAnswered && !isEditing && (
                          <div className="mt-3 bg-green-50 border-2 border-green-100 rounded-2xl p-4">

                            <div className="flex justify-between items-center mb-2">

                              <span className="text-xs font-black text-green-700">
                                👩‍🏫 TEACHER'S ANSWER
                              </span>

                              <button
                                type="button"
                                onClick={() => {
                                  setAnsweringId(question.id);
                                  setAnswerDraft(
                                    question.answer || ''
                                  );
                                }}
                                className="text-xs font-black text-slate-500 hover:text-indigo-600"
                              >
                                <Edit3 className="w-3 h-3 inline mr-1" />
                                Edit
                              </button>

                            </div>

                            <p className="font-semibold whitespace-pre-line leading-relaxed">
                              {question.answer}
                            </p>

                          </div>
                        )}

                        {/* ANSWER FORM */}
                        {isEditing && (
                          <div className="mt-3 bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-3">

                            <textarea
                              rows={4}
                              autoFocus
                              value={answerDraft}
                              onChange={(e) =>
                                setAnswerDraft(e.target.value)
                              }
                              placeholder="Write a clear answer for your students..."
                              className="w-full rounded-xl border-2 border-indigo-200 p-3 font-medium focus:outline-none focus:border-indigo-500 resize-y"
                            />

                            <div className="flex justify-end gap-2 mt-2">

                              <button
                                type="button"
                                onClick={() => {
                                  setAnsweringId(null);
                                  setAnswerDraft('');
                                }}
                                className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black"
                              >
                                Cancel
                              </button>

                              <button
                                type="button"
                                disabled={
                                  isSavingAnswer ||
                                  !answerDraft.trim()
                                }
                                onClick={() =>
                                  handleSaveAnswer(
                                    question.id
                                  )
                                }
                                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-50"
                              >
                                {isSavingAnswer
                                  ? 'Posting...'
                                  : 'Post Answer'}
                              </button>

                            </div>
                          </div>
                        )}

                        {!isAnswered && !isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setAnsweringId(question.id);
                              setAnswerDraft('');
                            }}
                            className="mt-3 w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm"
                          >
                            <Edit3 className="w-4 h-4 inline mr-2" />
                            Answer Question
                          </button>
                        )}

                      </div>
                    );
                  })}

                </div>
              )}

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="relative z-10 py-4 text-center bg-white/80 border-t border-pink-100 text-xs text-slate-400 font-semibold">
        🐾 Question Wall • Grade 4 English • Learn together!
      </footer>

      {/* =========================================================
          DELETE CONFIRMATION
      ========================================================= */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border-2 border-rose-100 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-3">🗑️</div>

            <h3 className="text-xl font-black">
              Delete this question?
            </h3>

            <p className="text-sm text-slate-500 font-semibold mt-2">
              This question will be removed from the Question Wall.
            </p>

            <div className="flex gap-2 mt-6">

              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 font-black"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() =>
                  handleDeleteQuestion(confirmDeleteId)
                }
                className="flex-1 py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black"
              >
                Delete
              </button>

            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          CLEAR ALL CONFIRMATION
      ========================================================= */}
      {confirmClearAll && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmClearAll(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border-2 border-rose-100 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-3">🧹</div>

            <h3 className="text-xl font-black">
              Clear all questions?
            </h3>

            <p className="text-sm text-slate-500 font-semibold mt-2">
              All questions currently on the Question Wall will be deleted.
            </p>

            <div className="flex gap-2 mt-6">

              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 font-black"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleClearAllQuestions}
                className="flex-1 py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black"
              >
                Clear All
              </button>

            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          QR MODAL
      ========================================================= */}
      {isQrModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsQrModalOpen(false)}
        >
          <div
            className="bg-white rounded-[2rem] border-4 border-pink-300 p-6 max-w-md w-full text-center shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >

            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-4xl mb-2">
              🐰 🐱 🐻
            </div>

            <h3 className="text-2xl font-black">
              Scan to Ask! 📱
            </h3>

            <p className="text-slate-500 text-sm font-semibold mt-2">
              Scan this QR code to open the student question page.
            </p>

            {qrCodeDataUrl && (
              <div className="mt-5 inline-block bg-white p-3 rounded-3xl border-2 border-pink-200 shadow-sm">
                <img
                  src={qrCodeDataUrl}
                  alt="Student Question Page QR Code"
                  className="w-64 h-64 object-contain"
                />
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyLink}
              className="mt-5 w-full py-3 rounded-2xl bg-pink-400 hover:bg-pink-500 text-white font-black"
            >
              <Copy className="w-4 h-4 inline mr-2" />
              {copyFeedback
                ? 'Copied! ✓'
                : 'Copy Student Page Link'}
            </button>

          </div>
        </div>
      )}

    </div>
  );
}
