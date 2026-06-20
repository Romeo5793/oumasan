import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Plus, Trash2, Target, Zap, Flag, PlayCircle, Star, Search, Bot, Loader2, AlertCircle, Save, ExternalLink, Calendar, Smartphone } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, query } from 'firebase/firestore';

// --- Firebase の初期設定 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const getNumberColor = (num) => {
  const colors = [
    'bg-white text-gray-800 border-gray-300', 'bg-gray-800 text-white border-gray-900', 'bg-red-500 text-white border-red-600', 'bg-blue-500 text-white border-blue-600',
    'bg-yellow-400 text-gray-900 border-yellow-500', 'bg-green-500 text-white border-green-600', 'bg-orange-500 text-white border-orange-600', 'bg-pink-400 text-white border-pink-500',
  ];
  return colors[(num - 1) % 8] || colors[0];
};

export default function App() {
  const [user, setUser] = useState(null);
  const [races, setRaces] = useState([]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [localHorses, setLocalHorses] = useState([]);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFetchingAI, setIsFetchingAI] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [toastMsg, setToastMsg] = useState(null);

  // APIキー関連のステートを追加
  const [appApiKey, setAppApiKey] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);

  useEffect(() => {
    if (!user) return;
    const racesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'races');
    const q = query(racesRef);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const raceData = [];
      snapshot.forEach(doc => raceData.push({ id: doc.id, ...doc.data() }));
      raceData.sort((a, b) => (!b.date ? -1 : !a.date ? 1 : new Date(b.date) - new Date(a.date)));
      setRaces(raceData);
    }, () => showToast("データの同期に失敗しました", "error"));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const currentRace = races.find(r => r.raceId === selectedRaceId);
    setLocalHorses(currentRace?.horses || []);
  }, [selectedRaceId, races]);

  const showToast = (msg, type = 'info') => {
    setToastMsg({ text: msg, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  const saveToFirestore = async (horsesToSave) => {
    if (!user || !selectedRaceId) return;
    try {
      const raceRef = doc(db, 'artifacts', appId, 'users', user.uid, 'races', selectedRaceId);
      await setDoc(raceRef, { horses: horsesToSave }, { merge: true });
    } catch (e) {
      showToast("保存エラー", "error");
    }
  };

  const updateHorse = (id, field, value) => {
    const updated = localHorses.map(h => h.id === id ? { ...h, [field]: value } : h);
    setLocalHorses(updated);
    saveToFirestore(updated);
  };

  const addHorse = () => {
    if (!selectedRaceId) return showToast("レースを選択してください", "error");
    const newNumber = localHorses.length > 0 ? Math.max(...localHorses.map(h => h.number)) + 1 : 1;
    const updated = [...localHorses, { id: Date.now(), number: newNumber, name: `追加馬${newNumber}`, odds: 10.0, speed: 70, jockey: 5, condition: 3, suitability: 3 }];
    setLocalHorses(updated);
    saveToFirestore(updated);
  };

  const removeHorse = (id) => {
    const updated = localHorses.filter(h => h.id !== id);
    setLocalHorses(updated);
    saveToFirestore(updated);
  };

  // --- 高精度化された AI リサーチ機能 ---
  const handleAIResearch = async () => {
    if (!user) return;
    setIsFetchingAI(true);
    setAiMessage('AIアナリストが詳細データを調査中...');
    
    try {
      const existingRaceNames = races.map(r => r.raceName).join(', ');
      
      // プロンプトを大幅に強化・具体化
      const prompt = `
        あなたはプロの競馬データアナリストです。現在は2026年6月20日（土曜日）です。
        今週末（2026年6月20日〜21日）に開催されるJRA（中央競馬）の主要な重賞レースまたはメインレースについて、Google検索を用いて正確な出馬表と最新情報を調査してください。

        【厳格な調査・算出ルール】
        1. 実際のレース名、開催競馬場、距離、馬番、馬名を正確に取得してください。
        2. 「単勝オッズ(odds)」は最新の実データ、または専門媒体の予想オッズを正確に反映してください。
        3. 各馬の能力パラメータは、検索で得られた情報を元に以下のように論理的に算出してください：
           - speed (1-100): 持ちタイムや近走の上がり3Fタイム、着順から評価（有力馬は80以上）
           - jockey (1-10): 騎乗予定騎手のリーディング順位、コース相性、直近の勝率から評価
           - condition (1-5): 追い切り（調教）評価やネット上の専門家の予想印（◎〇▲）の多さから評価
           - suitability (1-5): そのコース（右/左、坂の有無）や距離における過去の成績から評価
        4. すでにシステムに存在するレース（既存データ: [ ${existingRaceNames || 'なし'} ]）については、オッズ変動や出走取消などの最新の差分を反映して更新版を作成してください。存在しない場合は、今週末の注目レースを1〜2つ新規に作成してください。
      `;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${appApiKey}`;
      
      let res;
      for (let i = 0; i < 3; i++) {
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }], // 検索ツールの使用を明示
              systemInstruction: { parts: [{ text: "プロの競馬アナリストとして、指示された正確なJSONスキーマのみを出力してください。架空のデータは避け、検索結果に基づいた論理的な数値を設定してください。" }]},
              generationConfig: { 
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    races: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          raceId: { type: "STRING" },
                          raceName: { type: "STRING" },
                          date: { type: "STRING" },
                          track: { type: "STRING" },
                          distance: { type: "STRING" },
                          horses: {
                            type: "ARRAY",
                            items: {
                              type: "OBJECT",
                              properties: {
                                id: { type: "NUMBER" },
                                number: { type: "NUMBER" },
                                name: { type: "STRING" },
                                odds: { type: "NUMBER" },
                                speed: { type: "NUMBER" },
                                jockey: { type: "NUMBER" },
                                condition: { type: "NUMBER" },
                                suitability: { type: "NUMBER" }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            })
          });
          if (res.ok) break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (text) {
        setAiMessage('解析結果をクラウドに保存中...');
        const parsed = JSON.parse(text);
        if (parsed && parsed.races) {
          let lastId = selectedRaceId;
          for (const race of parsed.races) {
            const raceRef = doc(db, 'artifacts', appId, 'users', user.uid, 'races', race.raceId);
            await setDoc(raceRef, race, { merge: true });
            lastId = race.raceId;
          }
          if (lastId) {
            setSelectedRaceId(lastId);
            showToast("詳細なレース調査と更新が完了しました！", "success");
          }
        }
      }
    } catch (e) {
      console.error(e);
      showToast("調査に失敗しました", "error");
    } finally {
      setIsFetchingAI(false);
      setAiMessage('');
    }
  };

  const analyzedData = useMemo(() => {
    if (localHorses.length === 0) return [];
    const scoredHorses = localHorses.map(horse => {
      const rawScore = (Number(horse.speed) * 0.5) + (Number(horse.jockey) * 10 * 0.2) + (Number(horse.condition) * 20 * 0.15) + (Number(horse.suitability) * 20 * 0.15);
      return { ...horse, rawScore, weight: Math.pow(rawScore, 3) };
    });
    const totalWeight = scoredHorses.reduce((sum, h) => sum + h.weight, 0);

    return scoredHorses.map(horse => {
      const predictedProb = totalWeight > 0 ? horse.weight / totalWeight : 0;
      const impliedProb = horse.odds > 0 ? 1 / Number(horse.odds) : 0;
      const expectedValue = predictedProb * Number(horse.odds);

      let evaluation = { label: 'C', word: '見送り', style: 'bg-gray-200 text-gray-600' };
      if (expectedValue >= 1.5) evaluation = { label: 'SS', word: '超大当たり!', style: 'bg-pink-500 text-white' };
      else if (expectedValue >= 1.2) evaluation = { label: 'S', word: '大チャンス', style: 'bg-orange-500 text-white' };
      else if (expectedValue >= 1.0) evaluation = { label: 'A', word: 'イイね!', style: 'bg-yellow-400 text-orange-900' };
      else if (expectedValue >= 0.8) evaluation = { label: 'B', word: 'おさえ', style: 'bg-blue-100 text-blue-700' };

      return {
        ...horse,
        predictedProb: (predictedProb * 100).toFixed(1),
        impliedProb: (impliedProb * 100).toFixed(1),
        expectedValue: expectedValue.toFixed(2),
        evaluation
      };
    }).sort((a, b) => b.expectedValue - a.expectedValue);
  }, [localHorses]);

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    setTimeout(() => setIsAnalyzing(false), 500);
  };

  const currentRaceInfo = races.find(r => r.raceId === selectedRaceId);

  // 外部サイトを開く関数（別タブで開く）
  const openExternalSite = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // APIキー入力フォームの送信処理
  const handleApiKeySubmit = (e) => {
    e.preventDefault();
    if (appApiKey.trim() !== '') {
      setIsApiKeySet(true);
    } else {
      showToast("APIキーを入力してください", "error");
    }
  };

  // APIキーが入力されていない場合はログイン画面を表示
  if (!isApiKeySet) {
    return (
      <div className="min-h-screen bg-[#FFFBF0] flex items-center justify-center p-4">
        {toastMsg && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center px-4 py-2 rounded shadow-md font-bold text-sm"
               style={{ backgroundColor: toastMsg.type === 'error' ? '#fee2e2' : '#dcfce7', color: toastMsg.type === 'error' ? '#991b1b' : '#166534' }}>
            {toastMsg.text}
          </div>
        )}
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border-4 border-yellow-300">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-orange-100 rounded-full border-2 border-orange-200">
              <Bot className="w-12 h-12 text-orange-500" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-center text-orange-800 mb-2">ハッピー予想AI</h1>
          <p className="text-center text-sm font-bold text-orange-400 mb-8">AIアナリストを起動してください</p>
          
          <form onSubmit={handleApiKeySubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">APIキー (パスワード)</label>
              <input 
                type="password" 
                value={appApiKey}
                onChange={(e) => setAppApiKey(e.target.value)}
                className="w-full bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-3 font-bold text-gray-700 outline-none focus:border-orange-400 shadow-sm"
                placeholder="Gemini API Key..."
              />
            </div>
            <button 
              type="submit"
              className="w-full flex justify-center items-center px-6 py-4 bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-black rounded-xl shadow-[0_4px_0_rgba(194,65,12,1)] active:shadow-[0_0px_0_rgba(194,65,12,1)] active:translate-y-[4px] transition-all"
            >
              アプリを起動する
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF0] text-gray-800 font-sans p-2 sm:p-4">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center px-4 py-2 rounded shadow-md font-bold text-sm"
             style={{ backgroundColor: toastMsg.type === 'error' ? '#fee2e2' : '#dcfce7', color: toastMsg.type === 'error' ? '#991b1b' : '#166534' }}>
          {toastMsg.text}
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-4">
        
        <div className="flex justify-end gap-2 px-1">
          {/* aタグではなくbuttonとonClickに変更し、確実に遷移させる */}
          <button 
            onClick={() => openExternalSite('https://www.jra.go.jp/kouyu/app/')} 
            className="flex items-center gap-1 px-3 py-1 bg-white text-green-700 text-xs font-bold rounded-full border border-green-200 hover:bg-green-50 transition-colors"
          >
            <Smartphone className="w-3.5 h-3.5" /> アプリ
          </button>
          <button 
            onClick={() => openExternalSite('https://www.ipat.jra.go.jp/')} 
            className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full hover:bg-green-700 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> 即PAT
          </button>
        </div>

        <header className="bg-gradient-to-r from-orange-400 to-yellow-400 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white rounded-full"><Trophy className="w-6 h-6 text-orange-500" /></div>
            <div>
              <h1 className="text-2xl font-black text-white drop-shadow-sm">ハッピー予想AI</h1>
              <p className="text-xs text-orange-50 font-bold">高精度アナリストモード稼働中</p>
            </div>
          </div>
          <button onClick={handleAnalyze} className="flex items-center px-6 py-2 font-black text-orange-600 bg-white rounded-full hover:bg-orange-50 transition-colors">
            <PlayCircle className="w-5 h-5 mr-1 text-orange-500" /> 計算する！
          </button>
        </header>

        <div className="bg-white p-3 rounded-2xl border-2 border-yellow-200 flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 flex items-center gap-2 w-full">
            <Search className="w-5 h-5 text-orange-400 ml-2"/>
            <select className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold text-gray-700 outline-none focus:border-orange-400"
              value={selectedRaceId} onChange={(e) => setSelectedRaceId(e.target.value)}>
              <option value="" disabled={races.length > 0}>{races.length > 0 ? "レースを選択" : "AIに探してもらおう！"}</option>
              {races.map(r => <option key={r.raceId} value={r.raceId}>{r.date ? `${r.date} ` : ''}{r.raceName}</option>)}
            </select>
          </div>
          <button onClick={handleAIResearch} disabled={isFetchingAI} className="w-full md:w-auto flex justify-center items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg disabled:opacity-50 transition-colors">
            {isFetchingAI ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> {aiMessage}</> : <><Bot className="w-4 h-4 mr-2"/> アナリストAIに精密調査を依頼</>}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border-2 border-orange-100 overflow-hidden min-h-[300px]">
              <div className="p-3 bg-orange-50 flex justify-between items-center border-b border-orange-100">
                <div>
                  <h2 className="text-lg font-black text-orange-800 flex items-center">
                    <Flag className="w-5 h-5 mr-1 text-orange-500" />
                    {currentRaceInfo ? currentRaceInfo.raceName : 'データ入力'}
                  </h2>
                  {currentRaceInfo && (
                    <p className="text-xs font-bold text-gray-500 flex items-center mt-1">
                      <Calendar className="w-3 h-3 mr-1" /> {currentRaceInfo.date || '未定'} / {currentRaceInfo.track}・{currentRaceInfo.distance}
                    </p>
                  )}
                </div>
                <button onClick={addHorse} disabled={!selectedRaceId} className="px-3 py-1.5 bg-orange-400 disabled:bg-gray-300 text-white text-sm font-bold rounded-full">追加</button>
              </div>

              {!selectedRaceId ? (
                <div className="flex flex-col items-center justify-center h-48 text-orange-300">
                  <Bot className="w-12 h-12 mb-2" />
                  <p className="font-bold text-sm">上の青いボタンで精密調査を開始！</p>
                </div>
              ) : (
                <div className="p-2 overflow-x-auto">
                  <div className="min-w-[600px] space-y-2">
                    <div className="grid grid-cols-12 gap-1 text-xs font-bold text-orange-400 text-center pb-1">
                      <div className="col-span-1">枠</div>
                      <div className="col-span-3 text-left">馬名</div>
                      <div className="col-span-2">オッズ</div>
                      <div className="col-span-2">SP(1-100)</div>
                      <div className="col-span-3">騎/調/適</div>
                      <div className="col-span-1"></div>
                    </div>
                    {localHorses.map((horse) => (
                      <div key={horse.id} className="grid grid-cols-12 gap-1 items-center bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                        <div className="col-span-1 flex justify-center">
                          <input type="number" value={horse.number} onChange={(e) => updateHorse(horse.id, 'number', e.target.value)} className={`w-8 h-8 text-center font-bold text-sm rounded border border-gray-200 outline-none focus:border-orange-400 ${getNumberColor(horse.number)}`} />
                        </div>
                        <div className="col-span-3">
                          <input type="text" value={horse.name} onChange={(e) => updateHorse(horse.id, 'name', e.target.value)} className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-sm font-bold outline-none focus:border-orange-400" />
                        </div>
                        <div className="col-span-2 flex justify-center">
                          <input type="number" step="0.1" value={horse.odds} onChange={(e) => updateHorse(horse.id, 'odds', e.target.value)} className="w-14 bg-yellow-50 border border-yellow-200 rounded px-1 py-1 text-right text-orange-600 font-bold text-sm outline-none" />
                        </div>
                        <div className="col-span-2 flex justify-center">
                          <input type="number" value={horse.speed} onChange={(e) => updateHorse(horse.id, 'speed', e.target.value)} className="w-12 bg-white border border-gray-200 rounded px-1 py-1 text-center font-bold text-sm outline-none" />
                        </div>
                        <div className="col-span-3 flex justify-center gap-1">
                           <input type="number" max="10" min="1" value={horse.jockey} onChange={(e) => updateHorse(horse.id, 'jockey', e.target.value)} className="w-7 h-7 border border-gray-200 rounded text-center text-xs" title="騎手" />
                           <input type="number" max="5" min="1" value={horse.condition} onChange={(e) => updateHorse(horse.id, 'condition', e.target.value)} className="w-7 h-7 border border-gray-200 rounded text-center text-xs" title="調子" />
                           <input type="number" max="5" min="1" value={horse.suitability} onChange={(e) => updateHorse(horse.id, 'suitability', e.target.value)} className="w-7 h-7 border border-gray-200 rounded text-center text-xs" title="適性" />
                        </div>
                        <div className="col-span-1 flex justify-center">
                          <button onClick={() => removeHorse(horse.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-xs text-blue-800">
               <p className="font-bold flex items-center mb-1"><Bot className="w-4 h-4 mr-1 text-blue-600"/>高精度アナリストモードについて</p>
               <p>AIが「持ちタイム」「騎手リーディング」「予想印」などを検索し、論理的な基準でスピードや調子を自動算出するようになりました。</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl border-2 border-yellow-300 overflow-hidden min-h-[400px]">
              <div className="p-3 bg-gradient-to-r from-yellow-400 to-orange-400 flex justify-between items-center">
                <h2 className="text-lg font-black text-white flex items-center"><Target className="w-5 h-5 mr-1" /> お宝ランキング</h2>
              </div>
              
              <div className={`p-3 space-y-3 bg-orange-50/20 transition-opacity ${isAnalyzing ? 'opacity-50' : 'opacity-100'}`}>
                {!selectedRaceId && (
                   <div className="flex flex-col items-center justify-center py-10 text-orange-300">
                    <Target className="w-10 h-10 mb-2" />
                    <p className="font-bold">データを入れてね！</p>
                  </div>
                )}
                {selectedRaceId && analyzedData.map((horse) => (
                  <div key={horse.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 flex items-center justify-center rounded border font-bold text-xs ${getNumberColor(horse.number)}`}>{horse.number}</div>
                        <span className="font-black text-gray-800">{horse.name}</span>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${horse.evaluation.style}`}>{horse.evaluation.word}</span>
                    </div>

                    <div className="mb-2 bg-orange-50 p-2 rounded-lg">
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-orange-800">期待値</span>
                        <span className={`${horse.expectedValue >= 1.0 ? 'text-orange-600' : 'text-gray-500'}`}>{horse.expectedValue >= 1.0 ? '🔥 ' : ''}{horse.expectedValue}</span>
                      </div>
                      <div className="h-2 w-full bg-white rounded-full overflow-hidden border border-orange-100 relative">
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10" style={{ left: '50%' }}></div>
                        <div className={`h-full ${horse.expectedValue >= 1.5 ? 'bg-pink-400' : horse.expectedValue >= 1.2 ? 'bg-orange-400' : horse.expectedValue >= 1.0 ? 'bg-yellow-400' : 'bg-gray-300'}`} style={{ width: `${Math.min(horse.expectedValue * 100 / 2.0, 100)}%` }}></div>
                      </div>
                    </div>

                    <div className="flex justify-between text-center text-xs">
                      <div><p className="text-gray-400">AI勝率</p><p className="font-bold text-blue-600">{horse.predictedProb}%</p></div>
                      <div><p className="text-gray-400">みんなの勝率</p><p className="font-bold text-gray-600">{horse.impliedProb}%</p></div>
                      <div><p className="text-gray-400">オッズ</p><p className="font-bold text-orange-600">{horse.odds}倍</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}