import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calculator, AlertCircle, ArrowRightLeft, Calendar, Info, Trash2, Plus, Send, Bot, Sparkles, RotateCcw, ArrowUpCircle, Save, FolderOpen, X, User, Copy } from 'lucide-react';

// --- HILFSFUNKTIONEN ---
const formatCurrency = (value) => {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);
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

const fetchWithBackoff = async (url, options, maxRetries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 403 || response.status === 400) {
           const errText = await response.text();
           throw new Error(`Client Error ${response.status}: ${errText}`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      if (i === maxRetries || e.message.includes('Client Error')) throw e;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
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
  // --- GLOBALE STATE ---
  const [clientName, setClientName] = useState('');
  const [plannerStart, setPlannerStart] = useState(`${currentYear}-01-01`);
  const [plannerEnd, setPlannerEnd] = useState(`${currentYear}-12-31`);
  const referenceDate = new Date().toISOString().slice(0, 10); 
  
  const [campaigns, setCampaigns] = useState(generateInitialState());
  const [targetBudget, setTargetBudget] = useState(0); 
  
  // --- PROJEKT SPEICHER ---
  const [savedProjects, setSavedProjects] = useState([]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);

  // --- UI STATE ---
  const [rebalanceLog, setRebalanceLog] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [activeTotalInput, setActiveTotalInput] = useState({ id: null, value: '' });
  const chatEndRef = useRef(null);

  // --- DATENVALIDIERUNG ---
  const isInvalidDateRange = useMemo(() => {
    const s = parseDate(plannerStart);
    const e = parseDate(plannerEnd);
    return s && e && s > e;
  }, [plannerStart, plannerEnd]);

  // --- MONATS-GENERATOR ---
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

  // --- BERECHNUNG DER SUMMEN ---
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
    return { monthlyTotals, grandTotal };
  }, [campaigns, generatedMonths, plannerStart, plannerEnd, isInvalidDateRange]);

  const budgetExceededBy = totals.grandTotal - targetBudget;

  // --- MARKT-VERTEILUNG ---
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

  // --- PROJEKT HANDLER ---
  const handleSaveProject = () => {
    const snapshot = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString('de-DE', { hour12: false }),
      clientName: clientName || 'Unbenannter Kunde',
      plannerStart,
      plannerEnd,
      targetBudget,
      campaigns: JSON.parse(JSON.stringify(campaigns))
    };
    setSavedProjects(prev => [snapshot, ...prev]);
    setRebalanceLog(["Version/Projekt wurde erfolgreich im Zwischenspeicher gesichert."]);
  };

  const handleLoadProject = (project) => {
    setClientName(project.clientName);
    setPlannerStart(project.plannerStart);
    setPlannerEnd(project.plannerEnd);
    setTargetBudget(project.targetBudget);
    setCampaigns(project.campaigns);
    setIsProjectModalOpen(false);
    setRebalanceLog(["Projekt erfolgreich geladen."]);
  };

  // --- KAMPAGNEN HANDLER ---
  const handleDailyBudgetChange = (campId, monthKey, value) => {
    const numValue = parseInt(value, 10);
    const validValue = isNaN(numValue) || numValue < 0 ? 0 : numValue;
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, budgets: { ...c.budgets, [monthKey]: validValue } } : c));
    setRebalanceLog(null);
  };

  // Bidirektionaler Budget-Handler (Setzt ein einheitliches Tagesbudget für alle aktiven Monate)
  const handleCampaignTbChange = (campId, value) => {
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
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, startDate: plannerStart, endDate: plannerEnd } : c));
    setRebalanceLog(null);
  };

  const handleAddCampaign = () => {
    setCampaigns([...campaigns, { id: crypto.randomUUID(), market: '', name: 'Neue Kampagne', startDate: '', endDate: '', budgets: {} }]);
  };

  const handleDeleteCampaign = (campId) => {
    setCampaigns(prev => prev.filter(c => c.id !== campId));
    setRebalanceLog(null);
  };

  const handleDuplicateCampaign = (campId) => {
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

  const getWidthClass = (val) => {
    const len = String(val).length;
    if (len >= 4) return 'w-16'; 
    if (len === 3) return 'w-12'; 
    return 'w-10'; 
  };

  // --- KI-ASSISTENT ---
  const handleAiSubmit = async () => {
    if (!chatInput.trim()) return;
    setIsAiLoading(true);
    const userMessage = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);

    try {
      const apiKey = "AIzaSyCVLNFNK9YFLfVWGWr0xXR86jZUPT430r8"; 
      if (!apiKey) throw new Error("MISSING_API_KEY");

      const systemPrompt = `
        Du bist der KI-Planungsassistent für den "Media Budget Planner".
        Deine Aufgabe ist es, die Text-Anweisungen des Users in aktualisierte Kampagnendaten (JSON) zu übersetzen.
        
        WICHTIGER KONTEXT:
        - Geplanter globaler Zeitraum: ${plannerStart} bis ${plannerEnd}
        - Aktuelles Zielbudget: ${targetBudget}€
        - Aktuelle Kampagnenstruktur: ${JSON.stringify(campaigns)}
        - Stichtag (Heute): ${referenceDate}

        REGELN FÜR DIE BERECHNUNG:
        1. Eine Kampagne besteht aus { id, market, name, startDate: "YYYY-MM-DD" (oder leer ""), endDate: "YYYY-MM-DD" (oder leer ""), budgets: { "YYYY-MM": tagesbudget_als_zahl } }.
        2. Wenn der User spezifische Laufzeiten nennt, trage diese in 'startDate' und 'endDate' ein.
        3. Passe 'newTargetBudget' an, WENN der User explizit ein neues Gesamtbudget vorgibt.

        ANTWORT-SCHEMA (MUSS STRIKTES JSON SEIN):
        {
          "reply": "Kurze Bestätigung auf Deutsch.",
          "newTargetBudget": 50000, 
          "newCampaigns": [ ... Array aller Kampagnen ... ]
        }
      `;

      const payload = {
        contents: [{ parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json" }
      };

      const data = await fetchWithBackoff(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );

      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      rawText = rawText.replace(/```json/ig, '').replace(/```/g, '').trim();
      const result = JSON.parse(rawText);
      
      if (result.newCampaigns && Array.isArray(result.newCampaigns)) setCampaigns(result.newCampaigns);
      if (result.newTargetBudget && typeof result.newTargetBudget === 'number') setTargetBudget(result.newTargetBudget);
      setChatHistory(prev => [...prev, { role: 'ai', text: result.reply }]);

    } catch (error) {
      let errorMsg = 'Fehler bei der Datenverarbeitung.';
      if (error.message === "MISSING_API_KEY") {
         errorMsg = '⚠️ System-Info: Bitte hinterlege einen API-Key im Quellcode (`const apiKey`), um den KI-Assistenten zu nutzen.';
      } else if (error.message.includes('403')) {
         errorMsg = 'Zugriff verweigert (Fehler 403). Der hinterlegte API-Schlüssel ist nicht autorisiert.';
      } else if (error.message.includes('400')) {
         errorMsg = 'Ungültige Anfrage (Fehler 400).';
      }
      setChatHistory(prev => [...prev, { role: 'error', text: errorMsg }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isAiLoading]);

  // --- UMVERTEILUNGS-ALGORITHMUS (100% EXAKT) ---
  const performRebalance = (mode) => { 
    if (isInvalidDateRange) return;
    const diff = totals.grandTotal - targetBudget;
    
    if (mode === 'cut' && diff <= 0) return;
    if (mode === 'fill' && diff >= 0) return;

    let updatedCampaigns = JSON.parse(JSON.stringify(campaigns));
    
    const calcNewTotal = (camps) => {
      let t = 0;
      camps.forEach(c => {
        const cStart = c.startDate || plannerStart;
        const cEnd = c.endDate || plannerEnd;
        generatedMonths.forEach(m => {
           const d = getDaysOverlap(cStart, cEnd, m.actualStartStr, m.actualEndStr);
           t += (c.budgets[m.key] || 0) * d;
        });
      });
      return t;
    };

    let targetChange = Math.abs(diff);
    let slots = [];
    
    updatedCampaigns.forEach((c, cIdx) => {
      const campStartStr = c.startDate || plannerStart;
      const campEndStr = c.endDate || plannerEnd;
      generatedMonths.forEach(m => {
        if (m.actualEndStr >= referenceDate) {
           const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
           if (cDays > 0) {
             slots.push({ cIdx, mKey: m.key, activeDays: cDays, currentTb: (c.budgets[m.key] || 0) });
           }
        }
      });
    });

    if (slots.length === 0) {
      setRebalanceLog(["Fehler: Es konnten keine anpassbaren zukünftigen Monate gefunden werden."]);
      return;
    }

    if (mode === 'cut') {
       let remainingCut = targetChange;
       
       let it1 = 0;
       while (remainingCut > 0.5 && it1 < 50) {
          let activeSlots = slots.filter(s => s.currentTb > 10);
          if (activeSlots.length === 0) break;
          let weightSum = activeSlots.reduce((sum, s) => sum + ((s.currentTb - 10) * s.activeDays), 0);
          if (weightSum <= 0) break;

          let cutRound = 0;
          activeSlots.forEach(s => {
             let dailyCut = (remainingCut * (((s.currentTb - 10) * s.activeDays) / weightSum)) / s.activeDays;
             let actual = Math.min(dailyCut, s.currentTb - 10);
             s.currentTb -= actual;
             cutRound += actual * s.activeDays;
          });
          remainingCut -= cutRound;
          it1++;
       }

       let it2 = 0;
       while (remainingCut > 0.5 && it2 < 50) {
          let activeSlots = slots.filter(s => s.currentTb > 0);
          if (activeSlots.length === 0) break;
          let weightSum = activeSlots.reduce((sum, s) => sum + (s.currentTb * s.activeDays), 0);
          if (weightSum <= 0) break;

          let cutRound = 0;
          activeSlots.forEach(s => {
             let dailyCut = (remainingCut * ((s.currentTb * s.activeDays) / weightSum)) / s.activeDays;
             let actual = Math.min(dailyCut, s.currentTb);
             s.currentTb -= actual;
             cutRound += actual * s.activeDays;
          });
          remainingCut -= cutRound;
          it2++;
       }

       slots.forEach(s => updatedCampaigns[s.cIdx].budgets[s.mKey] = Math.floor(s.currentTb));
    } 
    
    if (mode === 'fill') {
       let remainingFill = targetChange;
       let it = 0;
       while (remainingFill > 0.5 && it < 50) {
          if (slots.length === 0) break;
          let weightSum = slots.reduce((sum, s) => sum + (s.currentTb > 0 ? s.currentTb * s.activeDays : s.activeDays), 0);
          if (weightSum <= 0) break;

          let fillRound = 0;
          slots.forEach(s => {
             let w = s.currentTb > 0 ? s.currentTb * s.activeDays : s.activeDays;
             let dailyFill = (remainingFill * (w / weightSum)) / s.activeDays;
             s.currentTb += dailyFill;
             fillRound += dailyFill * s.activeDays;
          });
          remainingFill -= fillRound;
          it++;
       }
       slots.forEach(s => updatedCampaigns[s.cIdx].budgets[s.mKey] = Math.floor(s.currentTb));
    }

    let finalTotal = calcNewTotal(updatedCampaigns);
    let gap = targetBudget - finalTotal;

    if (gap > 0) {
       slots.sort((a, b) => b.activeDays - a.activeDays);
       let added = true;
       while (gap > 0 && added && slots.length > 0) {
          added = false;
          for (let i=0; i < slots.length; i++) {
             if (gap >= slots[i].activeDays) {
                updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] += 1;
                gap -= slots[i].activeDays;
                added = true;
             }
          }
       }
    } else if (gap < 0) {
       slots.sort((a, b) => a.activeDays - b.activeDays);
       let subtracted = true;
       while (gap < 0 && subtracted && slots.length > 0) {
          subtracted = false;
          for (let i=0; i < slots.length; i++) {
             if (updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] > 0) {
                updatedCampaigns[slots[i].cIdx].budgets[slots[i].mKey] -= 1;
                gap += slots[i].activeDays;
                subtracted = true;
                break;
             }
          }
       }
    }

    setCampaigns(updatedCampaigns);
    setRebalanceLog([
      mode === 'cut' 
        ? `Budget erfolgreich auf Vorgabe gekürzt. (Abweichung zum Ziel: ${formatCurrency(Math.abs(gap))} €)`
        : `Restbudget erfolgreich verteilt. (Abweichung zum Ziel: ${formatCurrency(Math.abs(gap))} €)`
    ]);
  };

  const totalColumns = 8 + generatedMonths.length; // Markt + Kampagne + Gesamt + Start + Ende + Reset + Months + TOT + Trash

  return (
    <div className="min-h-screen bg-white text-black p-4 md:p-6 font-sans">
      <div className="max-w-[1900px] mx-auto space-y-8">
        
        {/* --- HEADER --- */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="relative h-12 flex items-center">
               <img src="image_3db660.png" alt="Brandnamic" className="h-full object-contain mr-3 filter grayscale" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
               <span style={{display: 'none'}} className="text-3xl font-black tracking-tighter text-black">brandnamic</span>
            </div>
            <div className="h-10 w-px bg-gray-300 mx-2 hidden md:block"></div>
            <div>
              <h1 className="text-xl font-black flex items-center gap-2 text-black uppercase tracking-wide">
                Media Budget Planner
              </h1>
              <p className="text-sm text-gray-500">Präzisionsplanung & Dynamische Umverteilung</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleSaveProject} className="flex items-center gap-2 px-4 py-2 border-2 border-black bg-white text-black hover:bg-gray-100 font-bold text-sm uppercase tracking-wider transition-colors">
              <Save size={16} /> Aktuellen Stand Speichern
            </button>
            <button onClick={() => setIsProjectModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-black text-white hover:bg-gray-800 font-bold text-sm uppercase tracking-wider transition-colors relative">
              <FolderOpen size={16} /> Projekte & Historie
              {savedProjects.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-white text-black border-2 border-black rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-black">{savedProjects.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* --- BRIEFING BOX --- */}
        <div className="bg-gray-50 p-6 border-2 border-black relative shadow-sm">
          <h2 className="font-black text-xs uppercase tracking-widest text-black mb-5 border-b-2 border-gray-200 pb-2">
            Briefing - Eckdaten
          </h2>
          
          <div className="flex flex-col xl:flex-row justify-between gap-8">
            
            {/* 2x2 Raster (Grid) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 flex-1 max-w-4xl">
              
              {/* Oben Links: Zeitraum Start */}
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                  <Calendar size={12} /> Zeitraum Start
                </label>
                <input type="date" value={plannerStart} onChange={(e) => setPlannerStart(e.target.value)} className="bg-white border border-gray-300 px-3 py-2 text-sm font-bold outline-none focus:border-black focus:ring-1 focus:ring-black w-full" />
              </div>

              {/* Oben Rechts: Zeitraum Ende */}
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                  <Calendar size={12} /> Zeitraum Ende
                </label>
                <input type="date" value={plannerEnd} onChange={(e) => setPlannerEnd(e.target.value)} className="bg-white border border-gray-300 px-3 py-2 text-sm font-bold outline-none focus:border-black focus:ring-1 focus:ring-black w-full" />
              </div>

              {/* Unten Links: Kunde */}
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                  <User size={12} /> Kunde
                </label>
                <input 
                  type="text" 
                  value={clientName} 
                  onChange={(e) => setClientName(e.target.value)} 
                  placeholder="z.B. Sensoria Dolomites"
                  className="bg-white border border-gray-300 px-3 py-2 text-sm font-bold outline-none focus:border-black focus:ring-1 focus:ring-black w-full" 
                />
              </div>

              {/* Unten Rechts: Gesamtbudget Vorgabe */}
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                  Gesamtbudget (Vorgabe Kunde)
                </label>
                <div className="relative flex items-center">
                  <input 
                    type="text" 
                    value={targetBudget === 0 ? '' : new Intl.NumberFormat('de-DE').format(targetBudget)} 
                    onChange={handleTargetBudgetChange} 
                    placeholder="0"
                    className="bg-white border-2 border-black pl-3 pr-8 py-2 text-base font-black outline-none focus:bg-gray-100 text-right w-full" 
                  />
                  <span className="absolute right-3 text-sm font-black text-gray-500">€</span>
                </div>
              </div>

            </div>
            
            {/* Live-Total Box */}
            <div className="flex flex-col xl:pl-8 xl:border-l-2 border-gray-200 justify-center items-start xl:items-end">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1 text-left xl:text-right">
                Gesamtbudget laut Tabelle (live)
              </label>
              <div className={`text-4xl font-black mt-1 ${budgetExceededBy > 0 ? 'text-black bg-gray-200 px-2 py-1 inline-block w-max' : 'text-black'}`}>
                {formatCurrency(totals.grandTotal)}
              </div>
            </div>

          </div>
        </div>

        {/* DATUMS-FEHLERMELDUNG */}
        {isInvalidDateRange && (
          <div className="bg-black text-white p-4 flex items-center gap-3 shadow-md border-l-4 border-red-500">
            <AlertCircle className="text-red-500" />
            <div>
              <h3 className="font-black uppercase tracking-wider text-sm">Ungültiger Zeitraum</h3>
              <p className="text-gray-300 text-sm">Der <strong className="text-white">Start-Zeitraum</strong> darf nicht nach dem <strong className="text-white">End-Zeitraum</strong> liegen. Bitte korrigieren.</p>
            </div>
          </div>
        )}

        {!isInvalidDateRange && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            
            {/* --- MAIN CONTENT --- */}
            <div className="xl:col-span-3 space-y-6">
              
              {/* ALERTS: OVER BUDGET */}
              {budgetExceededBy > 0 && (
                <div className="bg-black text-white p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="text-white" />
                    <div>
                      <h3 className="font-black uppercase tracking-wider text-sm">Budget überschritten</h3>
                      <p className="text-gray-300 text-sm">
                        Dein aktueller Plan ist um <strong className="text-white bg-gray-800 px-1">{formatCurrency(budgetExceededBy)}</strong> höher als das Zielbudget.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => performRebalance('cut')} className="bg-white text-black hover:bg-gray-200 px-5 py-2.5 text-sm font-black uppercase tracking-wider flex items-center gap-2 transition-colors whitespace-nowrap">
                    <ArrowRightLeft size={16} /> Automatisch Kürzen
                  </button>
                </div>
              )}

              {/* ALERTS: UNDER BUDGET (Surplus) */}
              {targetBudget > 0 && budgetExceededBy < 0 && (
                <div className="bg-gray-50 border-2 border-black p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <ArrowUpCircle className="text-black" />
                    <div>
                      <h3 className="font-black text-black uppercase tracking-wider text-sm">Budget verfügbar</h3>
                      <p className="text-gray-600 text-sm">
                        Du hast noch <strong className="text-black font-black">{formatCurrency(Math.abs(budgetExceededBy))}</strong> an ungenutztem Budget frei.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => performRebalance('fill')} className="bg-black text-white hover:bg-gray-800 px-5 py-2.5 text-sm font-black uppercase tracking-wider flex items-center gap-2 transition-colors whitespace-nowrap">
                    <ArrowUpCircle size={16} /> Restbudget verteilen
                  </button>
                </div>
              )}

              {/* ERFOLGSMELDUNG */}
              {rebalanceLog && (
                <div className="bg-white border-2 border-black p-4 flex items-start gap-3 shadow-sm">
                  <Info className="text-black mt-0.5" />
                  <div>
                    <h3 className="text-black font-black uppercase tracking-wider text-sm">Aktion erfolgreich</h3>
                    {rebalanceLog.map((log, i) => <p key={i} className="text-gray-700 text-sm mt-1 font-medium">{log}</p>)}
                  </div>
                </div>
              )}

              {/* TABELLE */}
              <div className="bg-white border border-black overflow-hidden flex flex-col shadow-sm">
                <div className="overflow-x-auto custom-scrollbar pb-4">
                  <table className="w-full text-sm text-left whitespace-nowrap table-auto">
                    
                    {/* HEADER */}
                    <thead className="bg-gray-100 border-b-2 border-black">
                      <tr>
                        <th className="px-4 py-3 font-black text-black sticky left-0 bg-gray-100 z-30 border-r border-gray-300 shadow-[1px_0_0_black] min-w-[100px] w-[100px] max-w-[100px]">MARKT</th>
                        <th className="px-4 py-3 font-black text-black sticky left-[100px] bg-gray-100 z-30 border-r border-black min-w-[130px] w-[130px] max-w-[200px]">KAMPAGNE</th>
                        <th className="px-3 py-3 font-black text-black border-r border-gray-300 text-xs min-w-[120px] w-[120px]">TB (Opt.)</th>
                        <th className="px-3 py-3 font-black text-black border-r border-gray-300 text-xs min-w-[110px] w-[110px]">START</th>
                        <th className="px-3 py-3 font-black text-black border-r border-gray-300 text-xs min-w-[110px] w-[110px]">ENDE</th>
                        <th className="px-1 py-3 border-r border-black text-center min-w-[32px] w-[32px]" title="Auf globalen Zeitraum zurücksetzen"></th>
                        {generatedMonths.map((m) => {
                          const isPast = m.actualEndStr < referenceDate;
                          return (
                            <th key={`head-${m.key}`} className={`px-2 py-2 text-center border-r border-gray-200 min-w-[90px] ${isPast ? 'bg-gray-200 text-gray-500' : 'text-black'}`}>
                              <div className="text-[10px] font-bold text-gray-400 leading-none mb-1">{m.days} T.</div>
                              <div className="font-bold">{m.name}</div>
                            </th>
                          );
                        })}
                        <th className="px-4 py-3 font-black text-black text-right bg-gray-200 border-l-2 border-black min-w-[100px]">TOT.</th>
                        <th className="px-3 py-2 text-center w-10"></th>
                      </tr>
                    </thead>

                    {/* --- SEKTION 1: TAGESBUDGETS --- */}
                    <tbody>
                      <tr>
                        <td colSpan={totalColumns} className="bg-black p-0 border-b-2 border-white">
                          <div className="sticky left-0 px-4 py-2 text-white font-bold text-sm uppercase tracking-widest inline-block">
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
                         const displayTb = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(avgTb);

                         return (
                          <tr key={`tb-${camp.id}`} className={`${rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-200 hover:bg-gray-100 group`}>
                            <td className="px-4 py-2 text-black sticky left-0 z-10 border-r border-gray-300 shadow-[1px_0_0_black]" style={{ backgroundColor: rIdx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                              <input type="text" value={camp.market} onChange={(e) => handleCampaignEdit(camp.id, 'market', e.target.value)} className="w-full bg-transparent font-bold outline-none focus:border-b-2 focus:border-black" placeholder="Markt" />
                            </td>
                            <td className="px-4 py-2 font-black text-black sticky left-[100px] z-10 border-r border-black" style={{ backgroundColor: rIdx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                              <input type="text" value={camp.name} onChange={(e) => handleCampaignEdit(camp.id, 'name', e.target.value)} className="w-full bg-transparent outline-none focus:border-b-2 focus:border-black" placeholder="Kampagnenname" />
                            </td>
                            <td className="px-2 py-2 border-r border-gray-300 align-middle bg-gray-50/50">
                              <div className="relative flex items-center justify-end w-full">
                                <input 
                                  type="text" 
                                  value={activeTotalInput.id === camp.id ? activeTotalInput.value : (avgTb === 0 ? '' : displayTb)} 
                                  onChange={(e) => setActiveTotalInput({ id: camp.id, value: e.target.value })} 
                                  onBlur={() => {
                                    if (activeTotalInput.id === camp.id) {
                                      handleCampaignTbChange(camp.id, activeTotalInput.value);
                                      setActiveTotalInput({ id: null, value: '' });
                                    }
                                  }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                  placeholder="-"
                                  className="w-full bg-transparent text-sm font-black text-black outline-none focus:border-b-2 focus:border-black text-right pr-4" 
                                />
                                <span className="absolute right-1 text-[10px] font-bold text-gray-500">€</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 border-r border-gray-300 align-middle">
                              <input type="date" value={camp.startDate} onChange={(e) => handleCampaignEdit(camp.id, 'startDate', e.target.value)} className="w-full bg-transparent text-xs font-bold text-gray-600 outline-none focus:text-black cursor-pointer" />
                            </td>
                            <td className="px-2 py-2 border-r border-gray-300 align-middle">
                              <input type="date" value={camp.endDate} onChange={(e) => handleCampaignEdit(camp.id, 'endDate', e.target.value)} className="w-full bg-transparent text-xs font-bold text-gray-600 outline-none focus:text-black cursor-pointer" />
                            </td>
                            <td className="px-1 py-2 border-r border-black align-middle text-center bg-gray-50/50">
                              <button 
                                onClick={() => setCampaignToFullRuntime(camp.id)} 
                                className="p-1 text-gray-500 hover:bg-black hover:text-white rounded transition-colors mx-auto flex items-center justify-center"
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
                              return (
                                <td key={`tb-${camp.id}-${m.key}`} className={`p-1 border-r border-gray-200 text-center ${isPast ? 'bg-gray-100' : (!isActive ? 'bg-gray-50' : '')}`}>
                                  {isActive ? (
                                    <div className="flex items-center justify-center">
                                      <input
                                        type="number" value={val === 0 ? '' : val} onChange={(e) => handleDailyBudgetChange(camp.id, m.key, e.target.value)} placeholder="-"
                                        className={`${getWidthClass(val)} text-center px-1 py-1 rounded-sm text-sm font-bold outline-none transition-all duration-200
                                          ${isPast ? 'bg-transparent text-gray-500 border border-transparent hover:border-gray-400 focus:border-black' : 'bg-white border border-gray-300 hover:border-black focus:border-black focus:ring-1 focus:ring-black text-black'}
                                        `}
                                      />
                                      <span className={`text-xs font-bold ml-1 ${isPast ? 'text-gray-500' : 'text-black'}`}>€</span>
                                      {cDays < m.days && <span className="text-[9px] font-bold text-gray-400 ml-1" title={`${cDays} aktive Tage`}>({cDays}T)</span>}
                                    </div>
                                  ) : (
                                    <span className="text-gray-300 text-xs">-</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-4 py-2 border-l-2 border-black bg-gray-100 text-right font-black text-black">
                               {formatCurrency(campTotal)}
                            </td>
                            <td className="px-2 py-2 text-center bg-white flex items-center justify-center gap-1 h-full min-h-[40px]">
                              <button onClick={() => handleDuplicateCampaign(camp.id)} className="text-gray-300 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100" title="Kampagne duplizieren (Boost)">
                                <Copy size={16} />
                              </button>
                              <button onClick={() => handleDeleteCampaign(camp.id)} className="text-gray-300 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100" title="Kampagne löschen">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {/* --- SUMME TAGESBUDGETS --- */}
                      <tr className="bg-gray-100 border-t-2 border-black">
                        <td className="px-4 py-3 font-black text-black text-left sticky left-0 z-20 bg-gray-100 border-r border-gray-300 shadow-[1px_0_0_black]">SUMME</td>
                        <td className="px-4 py-3 font-black text-black text-left sticky left-[100px] z-20 bg-gray-100 border-r border-black">Tagesbudgets</td>
                        <td className="border-r border-gray-300 bg-gray-100"></td>
                        <td className="border-r border-gray-300 bg-gray-100"></td>
                        <td className="border-r border-gray-300 bg-gray-100"></td>
                        <td className="border-r border-black bg-gray-100"></td>
                        {generatedMonths.map(m => {
                          let sum = 0;
                          campaigns.forEach(c => sum += (c.budgets[m.key] || 0));
                          return (
                             <td key={`sum-${m.key}`} className="px-1 py-3 text-center border-r border-gray-300 font-black text-black bg-gray-100">
                               {sum > 0 ? `${sum} €` : '-'}
                             </td>
                          );
                        })}
                        <td className="px-4 py-3 border-l-2 border-black bg-gray-100 text-right font-black text-black">
                          {formatCurrency(totals.grandTotal)}
                        </td>
                        <td className="px-2 py-2 bg-gray-100"></td>
                      </tr>

                      {/* --- KAMPAGNE HINZUFÜGEN BUTTON --- */}
                      <tr>
                        <td colSpan={totalColumns} className="bg-gray-50 p-0 border-t-2 border-gray-300 border-b-2 border-black">
                           <div className="sticky left-0 inline-block p-3 mb-6">
                              <button onClick={handleAddCampaign} className="text-xs font-black uppercase tracking-wider text-black hover:bg-gray-200 px-3 py-1.5 border border-black transition-colors flex items-center gap-1.5">
                                <Plus size={14} strokeWidth={3} /> Kampagne hinzufügen
                              </button>
                           </div>
                        </td>
                      </tr>
                    </tbody>

                    {/* --- SEKTION 2: GESAMTBUDGETS --- */}
                    <tbody>
                      <tr>
                        <td colSpan={totalColumns} className="bg-black p-0 border-t-4 border-white border-b-2 border-white">
                           <div className="sticky left-0 px-4 py-2 text-white font-bold text-sm uppercase tracking-widest inline-block">
                              Monats- & Gesamtbudgets (Berechnet)
                           </div>
                        </td>
                      </tr>
                      {campaigns.map((camp, rIdx) => {
                        let campTotal = 0;
                        const campStartStr = camp.startDate || plannerStart;
                        const campEndStr = camp.endDate || plannerEnd;

                        return (
                          <tr key={`tot-${camp.id}`} className={`${rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-200 hover:bg-gray-100`}>
                            <td className="px-4 py-2 font-bold text-black text-left sticky left-0 z-10 border-r border-gray-300 shadow-[1px_0_0_black]" style={{ backgroundColor: rIdx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>{camp.market}</td>
                            <td className="px-4 py-2 font-black text-black text-left sticky left-[100px] z-10 border-r border-black" style={{ backgroundColor: rIdx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>{camp.name}</td>
                            <td className="px-2 py-2 border-r border-gray-300 text-xs font-bold text-gray-500"></td>
                            <td className="px-2 py-2 border-r border-gray-300 text-xs font-bold text-gray-500">{formatDateStr(camp.startDate)}</td>
                            <td className="px-2 py-2 border-r border-gray-300 text-xs font-bold text-gray-500">{formatDateStr(camp.endDate)}</td>
                            <td className="px-1 py-2 border-r border-black"></td>
                            {generatedMonths.map((m) => {
                              const cDays = getDaysOverlap(campStartStr, campEndStr, m.actualStartStr, m.actualEndStr);
                              const val = camp.budgets[m.key] || 0;
                              const monthBudget = val * cDays;
                              campTotal += monthBudget;
                              return (
                                <td key={`tot-${camp.id}-${m.key}`} className={`px-3 py-2 text-center border-r border-gray-200 ${monthBudget === 0 ? 'text-gray-300' : 'text-black font-medium'}`}>
                                  {monthBudget === 0 ? '-' : formatCurrency(monthBudget)}
                                </td>
                              );
                            })}
                            <td className="px-4 py-2 font-black text-black text-right bg-gray-100 border-l-2 border-black">
                              {formatCurrency(campTotal)}
                            </td>
                            <td className="px-2 py-2 text-center"></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    
                    <tfoot className="bg-white border-t-4 border-black">
                      <tr>
                        <td className="px-4 py-4 font-black uppercase tracking-widest text-black text-left sticky left-0 z-20 bg-white border-r border-gray-300 shadow-[1px_0_0_black]">GESAMT</td>
                        <td className="px-4 py-4 font-black uppercase tracking-widest text-black text-left sticky left-[100px] z-20 bg-white border-r border-black">BUDGET</td>
                        <td className="border-r border-gray-300"></td>
                        <td className="border-r border-gray-300"></td>
                        <td className="border-r border-gray-300"></td>
                        <td className="border-r border-black"></td>
                        {generatedMonths.map((m) => (
                          <td key={`foot-${m.key}`} className="px-3 py-4 text-center font-black text-black border-r border-gray-300">
                            {formatCurrency(totals.monthlyTotals[m.key])}
                          </td>
                        ))}
                        <td className={`px-4 py-4 font-black text-right border-l-4 border-black text-lg ${budgetExceededBy > 0 ? 'bg-black text-white' : 'bg-gray-100 text-black'}`}>
                          {formatCurrency(totals.grandTotal)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>

            {/* --- SIDEBAR: KI ASSISTENT & VERTEILUNG --- */}
            <div className="xl:col-span-1 space-y-6">
              
              {/* MARKET SHARES WIDGET */}
              <div className="bg-white border-2 border-black shadow-sm">
                <div className="bg-black p-3 text-white flex items-center justify-between">
                  <h2 className="font-black uppercase tracking-wider text-xs">Budget-Verteilung (Markt)</h2>
                </div>
                <div className="p-4">
                  {marketShares.length === 0 || totals.grandTotal === 0 ? (
                    <p className="text-xs text-gray-500 font-bold">Noch keine Budgets geplant.</p>
                  ) : (
                    <div className="space-y-4">
                      {marketShares.map(ms => (
                        <div key={ms.market}>
                          <div className="flex justify-between items-end mb-1">
                            <span className="text-xs font-black uppercase tracking-wide">{ms.market}</span>
                            <span className="text-[11px] font-bold text-gray-600">
                              {formatCurrency(ms.amount)} <span className="text-black">({ms.percent.toFixed(1)}%)</span>
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 h-2">
                            <div className="bg-black h-2 transition-all duration-500" style={{ width: `${ms.percent}%` }}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* KI ASSISTENT */}
              <div className="bg-white border-2 border-black overflow-hidden flex flex-col h-[500px] xl:h-[calc(100vh-340px)] sticky top-6">
                <div className="bg-black p-4 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={18} className="text-white" />
                    <h2 className="font-black uppercase tracking-wider text-sm">Briefing Assistent</h2>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                  {chatHistory.length === 0 ? (
                    <div className="text-center text-gray-400 text-sm mt-10">
                      <Bot size={40} className="mx-auto mb-3 text-black opacity-30" />
                      <p className="font-bold text-black mb-2">Wie kann ich helfen?</p>
                      <p className="text-xs">"Plane eine DACH Kampagne ab 15.04. bis 30.08. mit 40€..."</p>
                    </div>
                  ) : (
                    chatHistory.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`text-[10px] font-black uppercase mb-1 ${msg.role === 'user' ? 'text-gray-400' : 'text-black'}`}>
                          {msg.role === 'user' ? 'Du' : msg.role === 'error' ? 'Fehler' : 'Assistent'}
                        </div>
                        <div className={`p-3 max-w-[90%] text-sm font-medium ${
                          msg.role === 'user' ? 'bg-black text-white rounded-l-xl rounded-br-xl' : 
                          msg.role === 'error' ? 'bg-white border-2 border-black text-black rounded-r-xl rounded-bl-xl font-bold' : 
                          'bg-white border border-gray-300 text-black shadow-sm rounded-r-xl rounded-bl-xl'
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                  
                  {isAiLoading && (
                    <div className="flex flex-col items-start">
                      <div className="text-[10px] font-black uppercase mb-1 text-black">Assistent</div>
                      <div className="bg-white border border-gray-300 shadow-sm rounded-r-xl rounded-bl-xl p-3 flex gap-1 items-center">
                        <div className="w-2 h-2 bg-black rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                        <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-3 bg-white border-t-2 border-black">
                  <div className="relative">
                    <textarea 
                      value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSubmit(); } }}
                      placeholder="Befehl eingeben..."
                      className="w-full bg-gray-100 border-2 border-transparent focus:border-black rounded-none pl-3 pr-10 py-3 text-sm font-medium outline-none resize-none"
                      rows="3" disabled={isAiLoading}
                    />
                    <button onClick={handleAiSubmit} disabled={isAiLoading || !chatInput.trim()} className="absolute right-2 bottom-2 p-2 bg-black text-white hover:bg-gray-800 transition-colors disabled:opacity-50">
                      <Send size={16} />
                    </button>
                  </div>
                  <div className="text-[9px] font-bold text-gray-400 mt-2 text-center uppercase tracking-widest">
                    {!isAiLoading && chatHistory.length === 0 ? 'Bitte API Key im Code hinterlegen' : 'Powered by Gemini AI'}
                  </div>
                </div>
                
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: PROJEKTE & HISTORIE */}
      {isProjectModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
             <div className="bg-black text-white p-4 flex justify-between items-center">
                <h2 className="font-black uppercase tracking-wider">Projekte & Versionen</h2>
                <button onClick={() => setIsProjectModalOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
             </div>
             <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
                <p className="text-xs text-gray-500 font-bold mb-4">
                   Hinweis: Diese Versionen sind im Zwischenspeicher gesichert. Nach einem Neuladen der Webseite gehen sie verloren.
                </p>
                {savedProjects.length === 0 ? (
                   <div className="text-center py-10 border-2 border-dashed border-gray-300 text-gray-400 font-bold">
                     Noch keine Versionen gespeichert.
                   </div>
                ) : (
                   <div className="space-y-3">
                      {savedProjects.map((proj) => (
                         <div key={proj.id} className="bg-white border-2 border-black p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
                            <div>
                               <h3 className="font-black text-black text-lg">{proj.clientName}</h3>
                               <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mt-1">
                                  {formatDateStr(proj.plannerStart)} — {formatDateStr(proj.plannerEnd)}
                               </p>
                            </div>
                            <div className="flex items-center gap-6">
                               <div className="text-right">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Zielbudget</p>
                                  <p className="font-black">{formatCurrency(proj.targetBudget)}</p>
                               </div>
                               <button 
                                 onClick={() => handleLoadProject(proj)}
                                 className="px-4 py-2 bg-black text-white hover:bg-gray-800 font-black uppercase text-xs tracking-wider border-2 border-black"
                               >
                                 Wiederherstellen
                               </button>
                            </div>
                         </div>
                      ))}
                   </div>
                )}
             </div>
          </div>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { height: 12px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f3f4f6; border-top: 2px solid #000; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #000000; border-radius: 0px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #374151; }
      `}} />
    </div>
  );
}