import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calculator, AlertCircle, ArrowRightLeft, Calendar, Info, Trash2, Plus, Send, Bot, Sparkles, RotateCcw, ArrowUpCircle, Save, FolderOpen, X, User, Copy, PanelRightClose, PanelRightOpen, Cloud, CloudOff, CheckCircle2, Download, Printer, Undo2 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INITIALISIERUNG ---
let firebaseConfig = {};
if (typeof __firebase_config !== 'undefined') {
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  firebaseConfig = {
apiKey: "AIzaSyBL9f_kigv3UYrLwq59hGj2VI7wV0G9-LU",
  authDomain: "brandnamic-media-planning-tool.firebaseapp.com",
  projectId: "brandnamic-media-planning-tool",
  storageBucket: "brandnamic-media-planning-tool.firebasestorage.app",
  messagingSenderId: "577187396851",
  appId: "1:577187396851:web:e05df3908fb9431d91cb86"
  };
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'media-planner-v1';

// --- HILFSFUNKTIONEN ---
const formatCurrency = (value) => {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
};

const formatNumber = (value) => {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
};

const formatDateStr = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return dateStr;
};

const parseDate = (str) => {
  if (!str) return null;
  return new Date(str + 'T00:00:00Z');
};

const getDaysOverlap = (start1Str, end1Str, start2Str, end2Str) => {
  const s1 = parseDate(start1Str);
  const e1 = parseDate(end1Str);
  const s2 = parseDate(start2Str);
  const e2 = parseDate(end2Str);
  if (!s1 || !e1 || !s2 || !e2) return 0;
  const start = s1 > s2 ? s1 : s2;
  const end = e1 < e2 ? e1 : e2;
  if (start > end) return 0;
  return Math.floor((end - start) / 86400000) + 1;
};

// Start-Template
const currentYear = new Date().getFullYear();
const generateInitialState = () => {
  return [
    { id: '1', market: 'DACH', name: 'Search', startDate: '', endDate: '', budgets: {} },
    { id: '2', market: 'IT', name: 'Search', startDate: '', endDate: '', budgets: {} },
    { id: '3', market: 'DACH', name: 'PMax', startDate: '', endDate: '', budgets: {} },
    { id: '4', market: 'IT', name: 'PMax', startDate: '', endDate: '', budgets: {} },
  ];
};

export default function App() {
  const [clientName, setClientName] = useState('');
  const [plannerStart, setPlannerStart] = useState(`${currentYear}-01-01`);
  const [plannerEnd, setPlannerEnd] = useState(`${currentYear}-12-31`);
  const referenceDate = new Date().toISOString().slice(0, 10); 
  
  const [campaigns, setCampaigns] = useState(generateInitialState());
  const [targetBudget, setTargetBudget] = useState(0); 
  
  // Undo Historie State
  const [history, setHistory] = useState([]);
  
  // Projekt-Management & Auto-Save
  const [savedProjects, setSavedProjects] = useState([]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [syncStatus, setSyncStatus] = useState(''); 

  // --- UNDO / HISTORY LOGIK ---
  const saveToHistory = (currentCampaigns) => {
    setHistory(prev => {
      const newHist = [...prev, JSON.parse(JSON.stringify(currentCampaigns))];
      return newHist.slice(-20); // Behalte max 20 Schritte im Speicher
    });
  };

  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const newHist = [...prev];
      const lastState = newHist.pop();
      setCampaigns(lastState);
      setRebalanceLog(["Letzte Aktion rückgängig gemacht."]);
      return newHist;
    });
  };

  // STRG+Z Event Listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const projectsRef = collection(db, 'artifacts', appId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = [];
      snapshot.forEach((document) => {
        loadedProjects.push({ id: document.id, ...document.data() });
      });
      loadedProjects.sort((a, b) => b.createdAt - a.createdAt);
      setSavedProjects(loadedProjects);
    }, (error) => {
      console.error("Firestore Error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // --- AUTO-SAVE LOGIK ---
  useEffect(() => {
    if (!activeProjectId || !user) return;
    setSyncStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const projectRef = doc(db, 'artifacts', appId, 'public', 'data', 'projects', activeProjectId);
        await setDoc(projectRef, {
          timestamp: new Date().toLocaleString('de-DE', { hour12: false }),
          clientName: clientName || 'Unbenannter Kunde',
          plannerStart,
          plannerEnd,
          targetBudget,
          campaigns: JSON.parse(JSON.stringify(campaigns))
        }, { merge: true }); 
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus(''), 2500); 
      } catch (error) {
        console.error("Auto-save error:", error);
        setSyncStatus('');
      }
    }, 1500); 
    return () => clearTimeout(timer);
  }, [campaigns, clientName, plannerStart, plannerEnd, targetBudget, activeProjectId, user]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [rebalanceLog, setRebalanceLog] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  
  const [activeTotalInput, setActiveTotalInput] = useState({ id: null, value: '' });
  const [activeDailyInput, setActiveDailyInput] = useState({ id: null, month: null, value: '' });
  
  const chatEndRef = useRef(null);

  const isInvalidDateRange = useMemo(() => {
    const s = parseDate(plannerStart);
    const e = parseDate(plannerEnd);
    return s && e && s > e;
  }, [plannerStart, plannerEnd]);

  const generatedMonths = useMemo(() => {
    if (isInvalidDateRange) return [];
    const months = [];
    const pStart = parseDate(plannerStart);
    const pEnd = parseDate(plannerEnd);
    if (!pStart || !pEnd) return [];

    let cYear = pStart.getUTCFullYear();
    let cMonth = pStart.getUTCMonth();
    const endYear = pEnd.getUTCFullYear();
    const endMonth = pEnd.getUTCMonth();

    while (cYear < endYear || (cYear === endYear && cMonth <= endMonth)) {
      const key = `${cYear}-${String(cMonth + 1).padStart(2, '0')}`;
      const mFirstDay = new Date(Date.UTC(cYear, cMonth, 1));
      const mLastDay = new Date(Date.UTC(cYear, cMonth + 1, 0));
      const actualStart = pStart > mFirstDay ? pStart : mFirstDay;
      const actualEnd = pEnd < mLastDay ? pEnd : mLastDay;
      const days = Math.floor((actualEnd - actualStart) / 86400000) + 1;

      if (days > 0) {
        const monthNames = ["Jan", "Feb", "Mrz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        months.push({
          key,
          name: `${monthNames[cMonth]} ${String(cYear).slice(-2)}`,
          days,
          actualStartStr: actualStart.toISOString().slice(0, 10),
          actualEndStr: actualEnd.toISOString().slice(0, 10),
        });
      }
      cMonth++;
      if (cMonth > 11) {
        cMonth = 0;
        cYear++;
      }
    }
    return months;
  }, [plannerStart, plannerEnd, isInvalidDateRange]);

  const totals = useMemo(() => {
    let monthlyTotals = {};
    generatedMonths.forEach(m => monthlyTotals[m.key] = 0);
    let grandTotal = 0;

    if (!isInvalidDateRange) {
      campaigns.forEach(camp => {
        const campStartStr = camp.startDate || plannerStart;
        const campEndStr = camp.endDate || plannerEnd;
        generatedMonths.forEach(m => {
          const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
          const tb = camp.budgets[m.key] || 0;
          const monthBudget = tb * cDays;
          monthlyTotals[m.key] += monthBudget;
          grandTotal += monthBudget;
        });
      });
    }
    
    grandTotal = Math.round(grandTotal * 100) / 100;
    return { monthlyTotals, grandTotal };
  }, [campaigns, generatedMonths, plannerStart, plannerEnd, isInvalidDateRange]);

  const budgetExceededBy = Math.round((totals.grandTotal - targetBudget) * 100) / 100;

  const marketShares = useMemo(() => {
    const shares = {};
    campaigns.forEach(camp => {
      const campStartStr = camp.startDate || plannerStart;
      const campEndStr = camp.endDate || plannerEnd;
      let campTotal = 0;
      generatedMonths.forEach(m => {
        const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
        campTotal += (camp.budgets[m.key] || 0) * cDays;
      });
      const mkt = camp.market.trim() || 'Ohne Markt';
      if (!shares[mkt]) shares[mkt] = 0;
      shares[mkt] += campTotal;
    });

    return Object.entries(shares)
      .map(([market, amount]) => ({
        market, amount, percent: totals.grandTotal > 0 ? (amount / totals.grandTotal) * 100 : 0
      }))
      .filter(ms => ms.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [campaigns, generatedMonths, plannerStart, plannerEnd, totals.grandTotal]);

  const handleSaveProject = async () => {
    if (!user) {
      setRebalanceLog(["Fehler: Keine Datenbank-Verbindung."]);
      return;
    }
    const projectId = activeProjectId || Date.now().toString();
    const projectData = {
      timestamp: new Date().toLocaleString('de-DE', { hour12: false }),
      createdAt: activeProjectId ? undefined : Date.now(), 
      clientName: clientName || 'Unbenannter Kunde',
      plannerStart,
      plannerEnd,
      targetBudget,
      campaigns: JSON.parse(JSON.stringify(campaigns))
    };
    try {
      const projectRef = doc(db, 'artifacts', appId, 'public', 'data', 'projects', projectId);
      await setDoc(projectRef, projectData, { merge: true });
      if (!activeProjectId) setActiveProjectId(projectId); 
      setRebalanceLog(["Projekt wurde gesichert! Ab sofort werden alle Änderungen in diesem Projekt automatisch gespeichert."]);
      setSyncStatus('saved');
      setTimeout(() => setSyncStatus(''), 2500);
    } catch (error) {
      console.error("Speicherfehler:", error);
      setRebalanceLog(["Fehler beim Speichern in der Cloud."]);
    }
  };

  const handleLoadProject = (project) => {
    setClientName(project.clientName);
    setPlannerStart(project.plannerStart);
    setPlannerEnd(project.plannerEnd);
    setTargetBudget(project.targetBudget);
    setCampaigns(project.campaigns);
    setActiveProjectId(project.id); 
    setIsProjectModalOpen(false);
    setHistory([]); 
    setRebalanceLog([`Projekt "${project.clientName}" geladen. Auto-Save ist aktiv.`]);
  };

  const handleNewProject = () => {
    setClientName('');
    setPlannerStart(`${currentYear}-01-01`);
    setPlannerEnd(`${currentYear}-12-31`);
    setTargetBudget(0);
    setCampaigns(generateInitialState());
    setActiveProjectId(null);
    setChatHistory([]);
    setHistory([]); 
    setRebalanceLog(["Neues, leeres Projekt gestartet. Die Auto-Save-Verbindung wurde getrennt."]);
    setSyncStatus('');
  };

  const handleDeleteProject = async (id) => {
    if (!user) return;
    try {
      const projectRef = doc(db, 'artifacts', appId, 'public', 'data', 'projects', id);
      await deleteDoc(projectRef);
      if (activeProjectId === id) setActiveProjectId(null); 
    } catch (error) {
      console.error("Löschfehler:", error);
    }
  };

  const handleDailyBudgetChange = (campId, monthKey, value) => {
    saveToHistory(campaigns);
    const strVal = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const numValue = parseFloat(strVal);
    const validValue = isNaN(numValue) || numValue < 0 ? 0 : numValue;
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, budgets: { ...c.budgets, [monthKey]: validValue } } : c));
    setRebalanceLog(null);
  };

  const handleCampaignTbChange = (campId, value) => {
    saveToHistory(campaigns);
    const strVal = value.replace(/[^\d.,]/g, '').replace(',', '.'); 
    if (strVal === '') {
      setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, budgets: {} } : c));
      return;
    }
    const newTb = parseFloat(strVal);
    if (isNaN(newTb)) return;
    
    setCampaigns(prev => prev.map(c => {
      if (c.id !== campId) return c;
      const campStartStr = c.startDate || plannerStart;
      const campEndStr = c.endDate || plannerEnd;
      const newBudgets = { ...c.budgets };
      generatedMonths.forEach(m => {
         if (getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr) > 0) {
            newBudgets[m.key] = newTb;
         }
      });
      return { ...c, budgets: newBudgets };
    }));
    setRebalanceLog(null);
  };

  const handleCampaignEdit = (campId, field, value) => {
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, [field]: value } : c));
    setRebalanceLog(null);
  };

  const setCampaignToFullRuntime = (campId) => {
    saveToHistory(campaigns);
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, startDate: plannerStart, endDate: plannerEnd } : c));
    setRebalanceLog(null);
  };

  const handleAddCampaign = () => {
    saveToHistory(campaigns);
    setCampaigns([...campaigns, { id: crypto.randomUUID(), market: '', name: 'Neue Kampagne', startDate: '', endDate: '', budgets: {} }]);
  };

  const handleDeleteCampaign = (campId) => {
    saveToHistory(campaigns);
    setCampaigns(prev => prev.filter(c => c.id !== campId));
    setRebalanceLog(null);
  };

  const handleDuplicateCampaign = (campId) => {
    saveToHistory(campaigns);
    const campToCopy = campaigns.find(c => c.id === campId);
    if (!campToCopy) return;
    const newCamp = {
      ...JSON.parse(JSON.stringify(campToCopy)), 
      id: crypto.randomUUID(),
      name: `${campToCopy.name} (Boost)`
    };
    const index = campaigns.findIndex(c => c.id === campId);
    const newCampaigns = [...campaigns];
    newCampaigns.splice(index + 1, 0, newCamp);
    setCampaigns(newCampaigns);
    setRebalanceLog(null);
  };

  const handleTargetBudgetChange = (e) => {
    const val = e.target.value.replace(/\D/g, ''); 
    setTargetBudget(parseInt(val, 10) || 0);
  };

  // --- REPARIERTER KI-ASSISTENT (Inlined Fetch für Canvas Interceptor) ---
  const handleAiSubmit = async () => {
    if (!chatInput.trim()) return;
    setIsAiLoading(true);
    const userMessage = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);

    try {
      const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
      const systemPrompt = `Du bist der KI-Planungsassistent für den "Media Budget Planner".
Deine Aufgabe ist es, die Text-Anweisungen des Users in aktualisierte Kampagnendaten zu übersetzen.
WICHTIGER KONTEXT:
- Geplanter globaler Zeitraum: ${plannerStart} bis ${plannerEnd}
- Aktuelles Zielbudget: ${targetBudget}€
- Aktuelle Kampagnenstruktur: ${JSON.stringify(campaigns)}
- Stichtag (Heute): ${referenceDate}

REGELN:
1. Analysiere die Anfrage des Users.
2. Wenn Budgets geändert werden sollen, passe die entsprechenden Monate in "budgets" an.
3. Wenn neue Kampagnen erstellt werden sollen, füge sie hinzu.
4. Gib IMMER ein gültiges JSON-Objekt zurück, das exakt dem geforderten Schema entspricht.
5. Das Feld "reply" MUSS eine kurze, freundliche Bestätigung auf Deutsch enthalten.`;

      const payload = {
        contents: [{ parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              reply: { type: "STRING" },
              newTargetBudget: { type: "NUMBER" },
              newCampaigns: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    id: { type: "STRING" },
                    market: { type: "STRING" },
                    name: { type: "STRING" },
                    startDate: { type: "STRING" },
                    endDate: { type: "STRING" },
                    budgets: { type: "OBJECT" }
                  }
                }
              }
            },
            required: ["reply", "newCampaigns"]
          }
        }
      };

      let data = null;
      let success = false;
      let lastError = null;
      const delays = [1000, 2000, 4000, 8000, 16000];
      
      // Clevere Warteschleife direkt hier, damit Canvas den "fetch" Call sauber sieht
      for (let i = 0; i <= 5; i++) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
            { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' }, 
              body: JSON.stringify(payload) 
            }
          );

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP Error ${response.status}: ${errText}`);
          }

          data = await response.json();
          success = true;
          break;
        } catch (err) {
          lastError = err;
          if (i < 5) await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
      }

      if (!success) {
        throw lastError;
      }

      let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      let result = {};
      try {
        result = JSON.parse(rawText);
      } catch(e) {
        console.error("JSON Parse Error:", rawText);
        throw new Error("Die KI hat eine ungültige Antwort geliefert.");
      }
      
      if (result.newCampaigns && Array.isArray(result.newCampaigns)) {
        saveToHistory(campaigns);
        setCampaigns(result.newCampaigns);
      }
      if (result.newTargetBudget !== undefined) setTargetBudget(result.newTargetBudget);
      
      const finalReply = result.reply || "Die gewünschten Änderungen wurden übernommen.";
      setChatHistory(prev => [...prev, { role: 'ai', text: finalReply }]);

    } catch (error) {
      console.error("AI Assistant Error Details:", error);
      setChatHistory(prev => [...prev, { role: 'error', text: `Ein Verbindungsfehler ist aufgetreten. (Stelle sicher, dass du in der Vorschau-Umgebung bist, oder einen eigenen API-Key bei Vercel hinterlegt hast).` }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isAiLoading]);

  const performRebalance = (mode) => { 
    if (isInvalidDateRange) return;
    const diff = budgetExceededBy; 
    
    if (mode === 'cut' && diff <= 0) return;
    if (mode === 'fill' && diff >= 0) return;

    saveToHistory(campaigns); 

    let updatedCampaigns = JSON.parse(JSON.stringify(campaigns));
    let futureTotal = 0;
    let totalFutureActiveDays = 0;
    let slots = [];
    
    updatedCampaigns.forEach((c, cIdx) => {
      const campStartStr = c.startDate || plannerStart;
      const campEndStr = c.endDate || plannerEnd;
      generatedMonths.forEach(m => {
        if (m.actualEndStr >= referenceDate) {
           const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
           if (cDays > 0) {
             const tb = c.budgets[m.key] || 0;
             futureTotal += (tb * cDays);
             totalFutureActiveDays += cDays;
             slots.push({ cIdx, mKey: m.key, activeDays: cDays, currentTb: tb });
           }
        }
      });
    });

    if (slots.length === 0) {
      setRebalanceLog(["Fehler: Es konnten keine anpassbaren zukünftigen Monate gefunden werden."]);
      return;
    }

    let newFutureTotal = futureTotal - diff; 

    if (newFutureTotal <= 0) {
       slots.forEach(s => {
          updatedCampaigns[s.cIdx].budgets[s.mKey] = 0;
       });
    } else {
       if (futureTotal > 0) {
          let scale = newFutureTotal / futureTotal;
          slots.forEach(s => {
             updatedCampaigns[s.cIdx].budgets[s.mKey] = Math.floor(s.currentTb * scale * 100) / 100;
          });
       } else {
          let daily = newFutureTotal / totalFutureActiveDays;
          slots.forEach(s => {
             updatedCampaigns[s.cIdx].budgets[s.mKey] = Math.floor(daily * 100) / 100;
          });
       }
    }

    let calcNewTotal = () => {
       let t = 0;
       updatedCampaigns.forEach(c => {
          const cStart = c.startDate || plannerStart;
          const cEnd = c.endDate || plannerEnd;
          generatedMonths.forEach(m => {
             const d = getDaysOverlap(cStart, cEnd, m.actualStartStr, m.actualEndStr);
             t += (c.budgets[m.key] || 0) * d;
          });
       });
       return Math.round(t * 100) / 100;
    };

    let currentTot = calcNewTotal();
    let gap = Math.round((targetBudget - currentTot) * 100) / 100; 

    if (gap > 0) {
       slots.sort((a, b) => b.activeDays - a.activeDays);
       let added = true;
       while (gap > 0 && added && slots.length > 0) {
          added = false;
          for (let i = 0; i < slots.length; i++) {
             let cost = Math.round(0.01 * slots[i].activeDays * 100) / 100;
             if (gap >= cost) {
                 updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] = Math.round((updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] + 0.01) * 100) / 100;
                 gap = Math.round((gap - cost) * 100) / 100;
                 added = true;
             }
          }
       }
    } else if (gap < 0) {
       slots.sort((a, b) => a.activeDays - b.activeDays);
       let subtracted = true;
       while (gap < 0 && subtracted && slots.length > 0) {
          subtracted = false;
          for (let i = 0; i < slots.length; i++) {
             if (updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] > 0) {
                let cost = Math.round(0.01 * slots[i].activeDays * 100) / 100;
                updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] = Math.round((updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] - 0.01) * 100) / 100;
                gap = Math.round((gap + cost) * 100) / 100;
                subtracted = true;
                break;
             }
          }
       }
    }

    setCampaigns(updatedCampaigns);
    setRebalanceLog([
      mode === 'cut' 
        ? `Budget erfolgreich auf Vorgabe gekürzt. (Abweichung: ${formatCurrency(Math.abs(gap))})`
        : `Restbudget erfolgreich verteilt. (Abweichung: ${formatCurrency(Math.abs(gap))})`
    ]);
  };

  const handleExportCSV = () => {
    const BOM = "\uFEFF"; 
    let csv = "Markt;Kampagne;Start;Ende;";
    generatedMonths.forEach(m => csv += `${m.name};`);
    csv += "Total\n";

    campaigns.forEach(camp => {
      const campStartStr = camp.startDate || plannerStart;
      const campEndStr = camp.endDate || plannerEnd;
      let campTotal = 0;
      let row = `${camp.market};${camp.name};${formatDateStr(campStartStr)};${formatDateStr(campEndStr)};`;

      generatedMonths.forEach(m => {
        const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
        const val = (camp.budgets[m.key] || 0) * cDays;
        campTotal += val;
        row += `${val.toFixed(2).replace('.', ',')};`;
      });
      row += `${campTotal.toFixed(2).replace('.', ',')}\n`;
      csv += row;
    });

    let footer = "SUMME;Tagesbudgets;;;";
    generatedMonths.forEach(m => {
      footer += `${totals.monthlyTotals[m.key].toFixed(2).replace('.', ',')};`;
    });
    footer += `${totals.grandTotal.toFixed(2).replace('.', ',')}\n`;
    csv += footer;

    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Media_Plan_${clientName ? clientName.replace(/[^a-z0-9]/gi, '_') : 'Projekt'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintPDF = () => {
    setIsPdfGenerating(true); 
    
    // Wir warten großzügig, bis React wirklich JEDES <input> Feld in ein <div> umgewandelt hat
    setTimeout(() => {
      try {
        window.print();
        setRebalanceLog(["Druck-Dialog geöffnet. Bitte als Ziel 'Als PDF speichern' wählen."]);
      } catch (error) {
        console.error("Print Error:", error);
        setRebalanceLog(["Fehler beim Öffnen des Druck-Dialogs."]);
      } finally {
        setIsPdfGenerating(false); 
      }
    }, 500); // 500 Millisekunden reichen völlig aus
  };

  const totalColumns = 8 + generatedMonths.length;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-gray-900 p-3 sm:p-6 font-sans selection:bg-black selection:text-white">
      <div className={`mx-auto space-y-6 ${isPdfGenerating ? 'pdf-render-mode w-full max-w-none px-0' : 'max-w-[1900px]'}`} id="pdf-export-area">
        
        {/* --- HEADER --- */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5">
          <div className="flex items-center gap-4">
            <div className="relative h-10 sm:h-12 flex items-center">
               <img src="image_3db660.png" alt="Brandnamic" className="h-full object-contain filter grayscale" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
               <span style={{display: 'none'}} className="text-2xl sm:text-3xl font-black tracking-tighter text-black">brandnamic</span>
            </div>
            <div className="h-10 w-px bg-gray-200 mx-1 hidden md:block"></div>
            <div>
              <h1 className="text-lg sm:text-xl font-black flex items-center gap-2 text-black uppercase tracking-wide">
                Media Budget Planner
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {activeProjectId ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                    <Cloud size={10} strokeWidth={3} /> Cloud Sync aktiv
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                    <CloudOff size={10} strokeWidth={3} /> Lokal (Nicht synchronisiert)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3 w-full lg:w-auto print-hide">
            <button onClick={handleUndo} disabled={history.length === 0} className="flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors shadow-sm flex disabled:opacity-50" title="Rückgängig (Strg+Z)">
              <Undo2 size={18} /> <span className="hidden sm:inline">Rückgängig</span>
            </button>
            <button onClick={handleExportCSV} className="flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors shadow-sm flex">
              <Download size={18} /> <span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={handlePrintPDF} disabled={isPdfGenerating} className="flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors shadow-sm flex disabled:opacity-50">
              {isPdfGenerating ? <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div> : <Printer size={18} />} 
              <span className="hidden sm:inline">{isPdfGenerating ? 'PDF...' : 'PDF'}</span>
            </button>
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-black font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors hidden xl:flex">
              {isSidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />} 
              <span className="hidden sm:inline">Assistent</span>
            </button>
            <button 
              onClick={handleSaveProject} 
              disabled={syncStatus === 'saving'}
              className={`flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 border border-gray-300 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors shadow-sm flex
                ${syncStatus === 'saving' ? 'bg-gray-50 text-gray-400' : syncStatus === 'saved' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white text-black hover:bg-gray-50'}
              `}
            >
              {syncStatus === 'saving' ? (
                <><div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin"></div> <span className="hidden sm:inline">Speichert...</span></>
              ) : syncStatus === 'saved' ? (
                <><CheckCircle2 size={18} /> <span className="hidden sm:inline">Gespeichert</span></>
              ) : (
                <><Save size={18} /> <span className="hidden sm:inline">Speichern</span></>
              )}
            </button>
            <button onClick={() => setIsProjectModalOpen(true)} className="flex-1 lg:flex-none justify-center items-center gap-2 px-4 py-2.5 bg-black text-white hover:bg-gray-800 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-xl transition-colors shadow-sm relative flex">
              <FolderOpen size={18} /> <span className="hidden sm:inline">Projekte</span>
              {savedProjects.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white shadow-sm border-2 border-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-black">{savedProjects.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* --- BRIEFING BOX --- */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200 relative shadow-sm break-inside-avoid">
          <div className="flex items-center justify-between mb-6 border-b border-gray-100 pb-3">
             <div className="flex items-center gap-2">
               <Calendar size={16} className="text-black" />
               <h2 className="font-black text-xs uppercase tracking-widest text-black">Briefing Eckdaten</h2>
             </div>
             {activeProjectId && (
               <button onClick={handleNewProject} className="text-[10px] font-bold uppercase tracking-wider bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors shadow-sm print-hide">
                 + Neues Projekt
               </button>
             )}
          </div>
          
          <div className="flex flex-col xl:flex-row justify-between gap-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 flex-1">
              <div className="flex flex-col w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                  <User size={12} /> Kunde
                </label>
                {isPdfGenerating ? (
                  <div className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold rounded-lg w-full min-h-[42px] flex items-center">{clientName || '-'}</div>
                ) : (
                  <input 
                    type="text" 
                    value={clientName} 
                    onChange={(e) => setClientName(e.target.value)} 
                    placeholder="z.B. Sensoria Dolomites"
                    className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black rounded-lg w-full transition-all" 
                  />
                )}
              </div>

              <div className="flex flex-col w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Zeitraum Start</label>
                {isPdfGenerating ? (
                  <div className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold rounded-lg w-full min-h-[42px] flex items-center">{formatDateStr(plannerStart)}</div>
                ) : (
                  <input type="date" value={plannerStart} onChange={(e) => setPlannerStart(e.target.value)} className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black rounded-lg w-full transition-all" />
                )}
              </div>

              <div className="flex flex-col w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Zeitraum Ende</label>
                {isPdfGenerating ? (
                  <div className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold rounded-lg w-full min-h-[42px] flex items-center">{formatDateStr(plannerEnd)}</div>
                ) : (
                  <input type="date" value={plannerEnd} onChange={(e) => setPlannerEnd(e.target.value)} className="bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-bold outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black rounded-lg w-full transition-all" />
                )}
              </div>

              <div className="flex flex-col w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                  Gesamtbudget (Kunde)
                </label>
                <div className="relative flex items-center">
                  {isPdfGenerating ? (
                    <div className="bg-white border-2 border-black pl-3 pr-8 py-2.5 text-sm font-black rounded-lg text-right w-full min-h-[42px] flex items-center justify-end">
                      {targetBudget === 0 ? '0' : new Intl.NumberFormat('de-DE').format(targetBudget)}
                    </div>
                  ) : (
                    <input 
                      type="text" 
                      value={targetBudget === 0 ? '' : new Intl.NumberFormat('de-DE').format(targetBudget)} 
                      onChange={handleTargetBudgetChange} 
                      placeholder="0"
                      className="bg-white border-2 border-black pl-3 pr-8 py-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-gray-200 rounded-lg text-right w-full transition-shadow" 
                    />
                  )}
                  <span className="absolute right-3 text-sm font-black text-gray-500">€</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-start sm:items-center xl:items-end justify-center pt-5 xl:pt-0 border-t border-gray-100 xl:border-t-0 xl:border-l xl:pl-8">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1 text-left sm:text-center xl:text-right">
                Gesamtbudget (Tabelle)
              </label>
              <div className={`text-3xl sm:text-4xl font-black mt-1 rounded-xl px-4 py-2 ${budgetExceededBy > 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-black border border-gray-200'}`}>
                {formatCurrency(totals.grandTotal)}
              </div>
            </div>
          </div>
        </div>

        {isInvalidDateRange && (
          <div className="bg-red-50 text-red-900 p-4 rounded-xl flex items-center gap-3 shadow-sm border border-red-200 print-hide">
            <AlertCircle className="text-red-500" />
            <div>
              <h3 className="font-black uppercase tracking-wider text-sm">Ungültiger Zeitraum</h3>
              <p className="text-sm">Der Start-Zeitraum darf nicht nach dem End-Zeitraum liegen. Bitte korrigieren.</p>
            </div>
          </div>
        )}

        {!isInvalidDateRange && (
          <div className={`grid grid-cols-1 ${isSidebarOpen ? 'xl:grid-cols-4' : 'xl:grid-cols-1'} gap-8 transition-all duration-300`}>
            
            {/* --- MAIN CONTENT --- */}
            <div className={`${isSidebarOpen ? 'xl:col-span-3' : 'xl:col-span-4'} space-y-6 min-w-0`}>
              
              {budgetExceededBy > 0 && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm print-hide">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-100 p-2 rounded-full"><AlertCircle className="text-red-600" size={20} /></div>
                    <div>
                      <h3 className="font-black uppercase tracking-wider text-sm text-red-900">Budget überschritten</h3>
                      <p className="text-red-700 text-sm mt-0.5">
                        Dein aktueller Plan ist um <strong className="bg-white px-1.5 py-0.5 rounded shadow-sm mx-1">{formatCurrency(budgetExceededBy)}</strong> höher als das Zielbudget.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => performRebalance('cut')} className="bg-red-600 text-white hover:bg-red-700 px-5 py-2.5 text-sm font-black uppercase tracking-wider rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-sm">
                    <ArrowRightLeft size={16} /> Automatisch Kürzen
                  </button>
                </div>
              )}

              {targetBudget > 0 && budgetExceededBy < 0 && (
                <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm print-hide">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-100 p-2 rounded-full"><ArrowUpCircle className="text-green-600" size={20} /></div>
                    <div>
                      <h3 className="font-black text-green-900 uppercase tracking-wider text-sm">Budget verfügbar</h3>
                      <p className="text-green-700 text-sm mt-0.5">
                        Du hast noch <strong className="bg-white px-1.5 py-0.5 rounded shadow-sm mx-1">{formatCurrency(Math.abs(budgetExceededBy))}</strong> an ungenutztem Budget frei.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => performRebalance('fill')} className="bg-green-600 text-white hover:bg-green-700 px-5 py-2.5 text-sm font-black uppercase tracking-wider rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shadow-sm">
                    <ArrowUpCircle size={16} /> Restbudget verteilen
                  </button>
                </div>
              )}

              {rebalanceLog && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex items-start gap-3 shadow-sm print-hide">
                  <Info className="text-blue-600 mt-0.5" size={20} />
                  <div>
                    <h3 className="text-blue-900 font-black uppercase tracking-wider text-sm">Info</h3>
                    {rebalanceLog.map((log, i) => <p key={i} className="text-blue-700 text-sm mt-1">{log}</p>)}
                  </div>
                </div>
              )}

              {/* TABELLE CONTAINER */}
              <div className={`bg-white rounded-2xl border border-gray-300 flex flex-col shadow-md ${isPdfGenerating ? '' : 'overflow-hidden'}`}>
                <div className={`${isPdfGenerating ? '' : 'overflow-x-auto custom-scrollbar'} pb-2`}>
                  <table className="w-full text-sm text-left whitespace-nowrap table-auto border-collapse">
                    
                    {/* HEADER */}
                    <thead className="bg-gray-200 border-b-2 border-gray-300">
                      <tr>
                        <th className={`px-4 py-4 font-black text-black uppercase tracking-wider text-xs bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-0 z-30'}`}>Markt</th>
                        <th className={`px-4 py-4 font-black text-black uppercase tracking-wider text-xs bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-[100px] z-30'}`}>Kampagne</th>
                        <th className="px-3 py-4 font-black text-gray-700 border-r border-gray-300 text-xs min-w-[120px] w-[120px]">TB (Opt.)</th>
                        <th className="px-3 py-4 font-black text-gray-700 border-r border-gray-300 text-xs min-w-[110px] w-[110px]">START</th>
                        <th className="px-3 py-4 font-black text-gray-700 border-r border-gray-300 text-xs min-w-[110px] w-[110px]">ENDE</th>
                        <th className="px-1 py-4 border-r border-gray-300 text-center min-w-[36px] w-[36px] print-hide" title="Auf globalen Zeitraum zurücksetzen"></th>
                        {generatedMonths.map((m) => {
                          const isPast = m.actualEndStr < referenceDate;
                          return (
                            <th key={`head-${m.key}`} className={`px-2 py-3 text-center border-r border-gray-300 min-w-[100px] ${isPast ? 'text-gray-400' : 'text-gray-800'}`}>
                              <div className="text-[10px] font-bold text-gray-400 leading-none mb-1.5">{m.days} T.</div>
                              <div className="font-black">{m.name}</div>
                            </th>
                          );
                        })}
                        <th className="px-4 py-4 font-black text-black text-right bg-gray-200 border-l-2 border-gray-300 min-w-[120px]">TOT.</th>
                        <th className="px-3 py-3 text-center bg-gray-200 w-12 print-hide"></th>
                      </tr>
                    </thead>

                    {/* --- SEKTION 1: TAGESBUDGETS --- */}
                    <tbody>
                      <tr>
                        <td colSpan={totalColumns} className="bg-gray-100 p-0 border-b-2 border-gray-300">
                          <div className={`px-4 py-3 text-black font-black text-xs uppercase tracking-widest inline-block bg-gray-100 ${isPdfGenerating ? '' : 'sticky left-0 z-30'}`}>
                            Tagesbudgets (Editierbar)
                          </div>
                        </td>
                      </tr>
                      {campaigns.map((camp, rIdx) => {
                         const campStartStr = camp.startDate || plannerStart;
                         const campEndStr = camp.endDate || plannerEnd;
                         
                         let campTotal = 0;
                         let totalActiveDays = 0;
                         generatedMonths.forEach((m) => {
                            const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
                            campTotal += (camp.budgets[m.key] || 0) * cDays;
                            totalActiveDays += cDays;
                         });
                         
                         const avgTb = totalActiveDays > 0 ? campTotal / totalActiveDays : 0;
                         const rowBg = rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-100';

                         return (
                          <tr key={`tb-${camp.id}`} className={`${rowBg} border-b border-gray-300 hover:bg-blue-50 transition-colors group break-inside-avoid`}>
                            
                            <td className={`px-4 py-2 text-black border-r border-gray-300 ${rowBg} group-hover:bg-blue-50 transition-colors ${isPdfGenerating ? '' : 'sticky left-0 z-20'}`}>
                              {isPdfGenerating ? (
                                <div className="font-bold py-1 whitespace-normal break-words min-h-[32px] flex items-center">{camp.market || '-'}</div>
                              ) : (
                                <input type="text" value={camp.market} onChange={(e) => handleCampaignEdit(camp.id, 'market', e.target.value)} className="w-full bg-transparent font-bold outline-none focus:border-b focus:border-black" placeholder="Markt" />
                              )}
                            </td>
                            
                            <td className={`px-4 py-2 font-black text-black border-r border-gray-300 ${rowBg} group-hover:bg-blue-50 transition-colors ${isPdfGenerating ? '' : 'sticky left-[100px] z-20'}`}>
                              {isPdfGenerating ? (
                                <div className="font-black py-1 whitespace-normal break-words min-h-[32px] flex items-center">{camp.name || '-'}</div>
                              ) : (
                                <input type="text" value={camp.name} onChange={(e) => handleCampaignEdit(camp.id, 'name', e.target.value)} className="w-full bg-transparent outline-none focus:border-b focus:border-black" placeholder="Kampagnenname" />
                              )}
                            </td>
                            
                            <td className={`px-2 py-2 border-r border-gray-300 align-middle ${rIdx % 2 === 0 ? 'bg-gray-50' : 'bg-gray-100'} group-hover:bg-blue-50 transition-colors`}>
                              <div className="relative flex items-center justify-end w-full">
                                {isPdfGenerating ? (
                                  <div className="text-sm font-black text-black text-right pr-4 py-1 min-h-[32px] flex items-center justify-end w-full">
                                    {avgTb === 0 ? '-' : formatNumber(avgTb)}
                                  </div>
                                ) : (
                                  <input 
                                    type="text" 
                                    value={activeTotalInput.id === camp.id ? activeTotalInput.value : (avgTb === 0 ? '' : formatNumber(avgTb))} 
                                    onChange={(e) => setActiveTotalInput({ id: camp.id, value: e.target.value })} 
                                    onBlur={() => {
                                      if (activeTotalInput.id === camp.id) {
                                        handleCampaignTbChange(camp.id, activeTotalInput.value);
                                        setActiveTotalInput({ id: null, value: '' });
                                      }
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                    placeholder="-"
                                    className="w-full bg-transparent text-sm font-black text-black outline-none focus:border-b focus:border-black text-right pr-4" 
                                  />
                                )}
                                <span className="absolute right-1 text-[10px] font-bold text-gray-400">€</span>
                              </div>
                            </td>

                            <td className="px-2 py-2 border-r border-gray-300 align-middle">
                              {isPdfGenerating ? (
                                <div className="w-full text-center text-[11px] font-bold text-gray-600 py-1">{formatDateStr(camp.startDate) || '-'}</div>
                              ) : (
                                <input type="date" value={camp.startDate} onChange={(e) => handleCampaignEdit(camp.id, 'startDate', e.target.value)} className="w-full bg-transparent text-[11px] font-bold text-gray-600 outline-none focus:text-black cursor-pointer" />
                              )}
                            </td>

                            <td className="px-2 py-2 border-r border-gray-300 align-middle">
                              {isPdfGenerating ? (
                                <div className="w-full text-center text-[11px] font-bold text-gray-600 py-1">{formatDateStr(camp.endDate) || '-'}</div>
                              ) : (
                                <input type="date" value={camp.endDate} onChange={(e) => handleCampaignEdit(camp.id, 'endDate', e.target.value)} className="w-full bg-transparent text-[11px] font-bold text-gray-600 outline-none focus:text-black cursor-pointer" />
                              )}
                            </td>

                            <td className="px-1 py-2 border-r border-gray-300 align-middle text-center print-hide">
                              <button 
                                onClick={() => setCampaignToFullRuntime(camp.id)} 
                                className="p-1.5 text-gray-400 hover:bg-gray-200 hover:text-black rounded-lg transition-colors mx-auto flex items-center justify-center"
                                title="Auf gesamte Laufzeit (Briefing) zurücksetzen"
                              >
                                <RotateCcw size={14} strokeWidth={2.5} />
                              </button>
                            </td>
                            
                            {generatedMonths.map((m) => {
                              const isPast = m.actualEndStr < referenceDate;
                              const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
                              const isActive = cDays > 0;
                              const val = camp.budgets[m.key] || 0;
                              const isCurrentlyActiveInput = activeDailyInput.id === camp.id && activeDailyInput.month === m.key;
                              
                              return (
                                <td key={`tb-${camp.id}-${m.key}`} className={`p-1.5 border-r border-gray-200 text-center ${isPast ? 'bg-gray-100/50' : ''}`}>
                                  {isActive ? (
                                    <div className="flex items-center justify-center">
                                      {isPdfGenerating ? (
                                        <div className={`text-center px-1.5 py-1.5 text-sm font-bold ${isPast ? 'text-gray-500' : 'text-black'}`}>
                                          {val === 0 ? '-' : formatNumber(val)}
                                        </div>
                                      ) : (
                                        <input
                                          type="text"
                                          value={isCurrentlyActiveInput ? activeDailyInput.value : (val === 0 ? '' : formatNumber(val))}
                                          onChange={(e) => setActiveDailyInput({ id: camp.id, month: m.key, value: e.target.value })}
                                          onBlur={() => {
                                            if (isCurrentlyActiveInput) {
                                              handleDailyBudgetChange(camp.id, m.key, activeDailyInput.value);
                                              setActiveDailyInput({ id: null, month: null, value: '' });
                                            }
                                          }}
                                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                          placeholder="-"
                                          className={`min-w-[64px] w-full max-w-[80px] text-center px-1.5 py-1.5 rounded-md text-sm font-bold outline-none transition-all duration-200
                                            ${isPast ? 'bg-transparent text-gray-500 border border-transparent' : 'bg-white border border-gray-300 hover:border-black focus:border-black focus:ring-1 focus:ring-black text-black shadow-sm'}
                                          `}
                                        />
                                      )}
                                      <span className={`text-[11px] font-bold ml-1 ${isPast ? 'text-gray-400' : 'text-gray-600'}`}>€</span>
                                      {cDays < m.days && <span className="text-[9px] font-bold text-blue-400 ml-1 print-hide" title={`${cDays} aktive Tage`}>({cDays}T)</span>}
                                    </div>
                                  ) : (
                                    <span className="text-gray-300 text-xs">-</span>
                                  )}
                                </td>
                              );
                            })}

                            <td className="px-4 py-3 font-black text-black text-right bg-gray-50 border-l-2 border-gray-300 group-hover:bg-blue-100 transition-colors">
                              {formatCurrency(campTotal)}
                            </td>
                            <td className="px-2 py-3 text-center print-hide">
                              <button onClick={() => handleDuplicateCampaign(camp.id)} className="p-1.5 text-gray-400 hover:bg-gray-200 hover:text-black rounded-lg transition-colors opacity-0 group-hover:opacity-100 mr-1" title="Kampagne duplizieren">
                                <Copy size={16} />
                              </button>
                              <button onClick={() => handleDeleteCampaign(camp.id)} className="p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Kampagne löschen">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                         );
                      })}

                      {/* --- SUMME TAGESBUDGETS --- */}
                      <tr className="bg-gray-200 border-t-2 border-b-2 border-gray-300">
                        <td className={`px-4 py-3.5 font-black text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-0 z-20'}`}>SUMME</td>
                        <td className={`px-4 py-3.5 font-black text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-[100px] z-20'}`}>Tagesbudgets</td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200 print-hide"></td>
                        {generatedMonths.map(m => {
                          let sum = 0;
                          campaigns.forEach(c => sum += (c.budgets[m.key] || 0));
                          return (
                             <td key={`sum-${m.key}`} className="px-2 py-3.5 text-center border-r border-gray-300 font-black text-gray-800 bg-gray-200">
                               {sum > 0 ? formatCurrency(sum) : '-'}
                             </td>
                          );
                        })}
                        <td className="px-4 py-3.5 border-l-2 border-gray-300 bg-gray-200 text-right font-black text-black">
                          {formatCurrency(totals.grandTotal)}
                        </td>
                        <td className="px-2 py-2 bg-gray-200 print-hide"></td>
                      </tr>

                      {/* --- KAMPAGNE HINZUFÜGEN BUTTON --- */}
                      <tr className="print-hide">
                        <td colSpan={totalColumns} className="bg-white p-0 border-b border-gray-300">
                           <div className={`inline-block p-4 ${isPdfGenerating ? '' : 'sticky left-0 z-10'}`}>
                              <button onClick={handleAddCampaign} className="text-xs font-black uppercase tracking-wider text-black bg-white hover:bg-gray-50 px-4 py-2 border border-gray-300 rounded-lg transition-colors shadow-sm flex items-center gap-2">
                                <Plus size={16} strokeWidth={2.5} /> Kampagne hinzufügen
                              </button>
                           </div>
                        </td>
                      </tr>
                    </tbody>

                    {/* --- SEKTION 2: GESAMTBUDGETS --- */}
                    <tbody>
                      <tr>
                        <td colSpan={totalColumns} className="bg-gray-100 p-0 border-b-2 border-gray-300">
                           <div className={`px-4 py-3 text-black font-black text-xs uppercase tracking-widest inline-block bg-gray-100 ${isPdfGenerating ? '' : 'sticky left-0 z-30'}`}>
                              Monats- & Gesamtbudgets (Berechnet)
                           </div>
                        </td>
                      </tr>
                      {campaigns.map((camp, rIdx) => {
                        let campTotal = 0;
                        const campStartStr = camp.startDate || plannerStart;
                        const campEndStr = camp.endDate || plannerEnd;
                        const rowBg = rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-100';

                        return (
                          <tr key={`tot-${camp.id}`} className={`${rowBg} border-b border-gray-300 hover:bg-blue-50 transition-colors group break-inside-avoid`}>
                            <td className={`px-4 py-3 font-bold text-gray-700 text-left border-r border-gray-300 ${rowBg} group-hover:bg-blue-50 transition-colors ${isPdfGenerating ? '' : 'sticky left-0 z-20'}`}>{camp.market || '-'}</td>
                            <td className={`px-4 py-3 font-black text-gray-900 text-left border-r border-gray-300 ${rowBg} group-hover:bg-blue-50 transition-colors ${isPdfGenerating ? '' : 'sticky left-[100px] z-20'}`}>{camp.name || '-'}</td>
                            <td className="px-4 py-3 border-r border-gray-300 text-center text-gray-400">-</td>
                            <td className="px-2 py-3 border-r border-gray-300 text-center text-[10px] text-gray-500">{formatDateStr(camp.startDate)}</td>
                            <td className="px-2 py-3 border-r border-gray-300 text-center text-[10px] text-gray-500">{formatDateStr(camp.endDate)}</td>
                            <td className="px-1 py-3 border-r border-gray-300 text-center print-hide"></td>
                            
                            {generatedMonths.map((m) => {
                              const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
                              const val = (camp.budgets[m.key] || 0) * cDays;
                              campTotal += val;
                              return (
                                <td key={`mtot-${camp.id}-${m.key}`} className="px-3 py-3 border-r border-gray-300 text-center font-bold text-gray-800">
                                  {val > 0 ? formatCurrency(val) : '-'}
                                </td>
                              );
                            })}
                            
                            <td className="px-4 py-3 font-black text-black text-right bg-gray-50 border-l-2 border-gray-300 group-hover:bg-blue-100 transition-colors">
                              {formatCurrency(campTotal)}
                            </td>
                            <td className="px-2 py-3 text-center print-hide"></td>
                          </tr>
                        );
                      })}

                      {/* --- SUMME MONATSBUDGETS --- */}
                      <tr className="bg-gray-200 border-t-2 border-b-2 border-gray-300 break-inside-avoid">
                        <td className={`px-4 py-3.5 font-black text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-0 z-20'}`}>SUMME</td>
                        <td className={`px-4 py-3.5 font-black text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-[100px] z-20'}`}>Monatsbudgets</td>
                        <td className="px-4 py-3.5 bg-gray-200 border-r border-gray-300"></td>
                        <td className="px-4 py-3.5 bg-gray-200 border-r border-gray-300"></td>
                        <td className="px-4 py-3.5 bg-gray-200 border-r border-gray-300"></td>
                        <td className="px-4 py-3.5 bg-gray-200 border-r border-gray-300 print-hide"></td>
                        {generatedMonths.map(m => (
                          <td key={`sum-month-${m.key}`} className="px-4 py-3.5 font-black text-center text-black border-r border-gray-300 bg-gray-200">
                            {totals.monthlyTotals[m.key] > 0 ? formatCurrency(totals.monthlyTotals[m.key]) : '-'}
                          </td>
                        ))}
                        <td className="bg-gray-200 border-l-2 border-gray-300"></td>
                        <td className="bg-gray-200 print-hide"></td>
                      </tr>
                    </tbody>
                    
                    {/* --- TFOOT: GLOBALE SUMME --- */}
                    <tfoot className="bg-white border-t-2 border-gray-400 shadow-t-md break-inside-avoid">
                      <tr>
                        <td className={`px-4 py-5 font-black uppercase tracking-widest text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-0 z-30'}`}>GESAMT</td>
                        <td className={`px-4 py-5 font-black uppercase tracking-widest text-black text-left bg-gray-200 border-r border-gray-300 ${isPdfGenerating ? '' : 'sticky left-[100px] z-30'}`}>BUDGET</td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200"></td>
                        <td className="border-r border-gray-300 bg-gray-200 print-hide"></td>
                        {generatedMonths.map((m) => (
                          <td key={`foot-${m.key}`} className="px-3 py-5 text-center font-black text-black border-r border-gray-300 bg-gray-200">
                            {formatCurrency(totals.monthlyTotals[m.key])}
                          </td>
                        ))}
                        <td className={`px-4 py-5 font-black text-right border-l-2 border-gray-300 text-xl ${budgetExceededBy > 0 ? 'bg-red-50 text-red-600' : 'bg-black text-white'} rounded-br-2xl`}>
                          {formatCurrency(totals.grandTotal)}
                        </td>
                        <td className="bg-gray-200 print-hide"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>

            {/* --- SIDEBAR: KI ASSISTENT & VERTEILUNG --- */}
            {isSidebarOpen && (
              <div className="xl:col-span-1 space-y-6">
                
                {/* MARKET SHARES WIDGET (Soll im PDF gedruckt werden) */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden break-inside-avoid">
                  <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
                    <h2 className="font-black uppercase tracking-wider text-xs text-black">Budget-Verteilung (Markt)</h2>
                  </div>
                  <div className="p-5">
                    {marketShares.length === 0 || totals.grandTotal === 0 ? (
                      <p className="text-xs text-gray-500 font-bold text-center py-4">Noch keine Budgets geplant.</p>
                    ) : (
                      <div className="space-y-4">
                        {marketShares.map(ms => (
                          <div key={ms.market}>
                            <div className="flex justify-between items-end mb-1.5">
                              <span className="text-xs font-black uppercase tracking-wide text-black">{ms.market}</span>
                              <span className="text-[11px] font-bold text-gray-500">
                                {formatCurrency(ms.amount)} <span className="text-black ml-1 bg-gray-100 px-1.5 py-0.5 rounded">{ms.percent.toFixed(1)}%</span>
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                              <div className="bg-black h-2 transition-all duration-500 rounded-full" style={{ width: `${ms.percent}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* KI ASSISTENT (Wird im PDF versteckt) */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[500px] xl:h-[calc(100vh-280px)] sticky top-6 print-hide">
                  <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="bg-blue-100 p-1.5 rounded-lg"><Sparkles size={16} className="text-blue-600" /></div>
                      <h2 className="font-black uppercase tracking-wider text-xs text-black">Briefing Assistent</h2>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
                    {chatHistory.length === 0 ? (
                      <div className="text-center text-gray-400 text-sm mt-10">
                        <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100"><Bot size={32} className="text-gray-400" /></div>
                        <p className="font-bold text-black mb-2">Wie kann ich helfen?</p>
                        <p className="text-xs leading-relaxed max-w-[200px] mx-auto">"Plane eine DACH Kampagne ab 15.04. bis 30.08. mit 40€ Tagesbudget..."</p>
                      </div>
                    ) : (
                      chatHistory.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className={`text-[9px] font-black uppercase mb-1 ${msg.role === 'user' ? 'text-gray-400' : 'text-black'}`}>
                            {msg.role === 'user' ? 'Du' : msg.role === 'error' ? 'System' : 'Assistent'}
                          </div>
                          <div className={`px-4 py-2.5 max-w-[90%] text-sm font-medium shadow-sm ${
                            msg.role === 'user' ? 'bg-black text-white rounded-2xl rounded-tr-sm' : 
                            msg.role === 'error' ? 'bg-red-50 border border-red-200 text-red-800 rounded-2xl rounded-tl-sm font-bold text-xs' : 
                            'bg-gray-50 border border-gray-100 text-black rounded-2xl rounded-tl-sm'
                          }`}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                    
                    {isAiLoading && (
                      <div className="flex flex-col items-start">
                        <div className="text-[9px] font-black uppercase mb-1 text-black">Assistent</div>
                        <div className="bg-gray-50 border border-gray-100 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3.5 flex gap-1.5 items-center">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="p-3 bg-gray-50 border-t border-gray-200">
                    <div className="relative">
                      <textarea 
                        value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSubmit(); } }}
                        placeholder="Befehl eingeben..."
                        className="w-full bg-white border border-gray-300 focus:border-black focus:ring-1 focus:ring-black rounded-xl pl-4 pr-12 py-3 text-sm font-medium outline-none resize-none shadow-sm transition-shadow"
                        rows="2" disabled={isAiLoading}
                      />
                      <button onClick={handleAiSubmit} disabled={isAiLoading || !chatInput.trim()} className="absolute right-2 bottom-2 p-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50">
                        <Send size={16} />
                      </button>
                    </div>
                    <div className="text-[9px] font-bold text-gray-400 mt-2 text-center uppercase tracking-widest">
                      Powered by Gemini AI
                    </div>
                  </div>
                  
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL: PROJEKTE & HISTORIE */}
      {isProjectModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
             <div className="bg-gray-50 border-b border-gray-200 p-5 flex justify-between items-center">
                <h2 className="font-black uppercase tracking-wider text-black">Gespeicherte Projekte</h2>
                <button onClick={() => setIsProjectModalOpen(false)} className="text-gray-400 hover:text-black bg-white rounded-full p-1 border border-gray-200 shadow-sm transition-colors"><X size={20} /></button>
             </div>
             <div className="p-6 overflow-y-auto flex-1 bg-white">
                <p className="text-xs text-gray-500 font-medium mb-6 bg-blue-50 text-blue-800 p-3 rounded-xl border border-blue-100 flex items-start gap-2">
                   <Info size={16} className="mt-0.5 shrink-0" />
                   Diese Projekte werden sicher in der Cloud gespeichert. Sobald du eines lädst, ist das <strong>Auto-Save</strong> aktiv.
