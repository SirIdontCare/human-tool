"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  DollarSign,
  AlertTriangle,
  Send,
  Play,
  Check,
  Plus,
  Trash2,
  UserCheck,
} from "lucide-react";

interface TaskData {
  id: string;
  quote_id: string;
  task_type: string;
  title: string;
  status: string;
  input_payload: Record<string, any>;
  customer_price_usd: number;
  target_payout_usd: number;
  sla_minutes: number;
  required_capability: string;
  risk_level: string;
  assigned_worker_id: string | null;
  created_at: string;
  updated_at: string;
}

const MOCK_WORKERS = [
  { id: "w_alex_ux", name: "Alex Rivera (Senior UX Specialist)", capability: "UX_CONVERSION_ANALYSIS" },
  { id: "w_sam_arch", name: "Sam Chen (Principal Cloud Architect)", capability: "SYSTEM_ARCHITECTURE" },
  { id: "w_elena_fact", name: "Dr. Elena Rostova (Research Analyst)", capability: "FACT_CHECKING" },
  { id: "w_morgan_general", name: "Morgan Taylor (Full-Stack Engineer)", capability: "ALL_CAPABILITIES" },
];

function WorkerTaskContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const taskId = params?.id as string;

  const [task, setTask] = useState<TaskData | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(
    searchParams?.get("worker_id") || "w_alex_ux"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<any>(null);

  // Form states for each task type
  // 1. Landing Page Review
  const [topIssues, setTopIssues] = useState<string[]>([""]);
  const [highestImpactChange, setHighestImpactChange] = useState("");
  const [conversionBlockers, setConversionBlockers] = useState<string[]>([""]);
  const [landingConfidence, setLandingConfidence] = useState(0.9);

  // 2. Architecture Sanity Check
  const [archVerdict, setArchVerdict] = useState<"good" | "acceptable" | "risky">("acceptable");
  const [criticalIssues, setCriticalIssues] = useState<string[]>([""]);
  const [recommendedChanges, setRecommendedChanges] = useState<string[]>([""]);
  const [scalingRisks, setScalingRisks] = useState<string[]>([""]);
  const [archConfidence, setArchConfidence] = useState(0.9);

  // 3. Expert Fact Verification
  const [factVerdict, setFactVerdict] = useState<"true" | "false" | "partial" | "cannot_confirm">("true");
  const [factExplanation, setFactExplanation] = useState("");
  const [sourceNotes, setSourceNotes] = useState("");
  const [factConfidence, setFactConfidence] = useState(0.95);

  const fetchTask = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load task");
      }
      const data = await res.json();
      setTask(data);
      if (data.assigned_worker_id) {
        setSelectedWorkerId(data.assigned_worker_id);
      }
      if (data.status === "COMPLETED") {
        // Fetch existing result
        const resResult = await fetch(`/api/tasks/${taskId}/result`);
        if (resResult.ok) {
          const resultData = await resResult.json();
          setSubmittedResult(resultData.result);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (taskId) {
      fetchTask();
    }
  }, [taskId]);

  const handleAccept = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept task");
      await fetchTask();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStart = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start task");
      await fetchTask();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitResult = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      let resultPayload: any = {};

      if (task?.task_type === "LANDING_PAGE_REVIEW") {
        const filteredIssues = topIssues.filter((i) => i.trim().length > 0);
        if (filteredIssues.length === 0) throw new Error("Please add at least one top issue.");
        if (!highestImpactChange.trim()) throw new Error("Please provide the highest impact change.");

        resultPayload = {
          top_issues: filteredIssues,
          highest_impact_change: highestImpactChange.trim(),
          conversion_blockers: conversionBlockers.filter((b) => b.trim().length > 0),
          confidence: Number(landingConfidence),
        };
      } else if (task?.task_type === "ARCHITECTURE_SANITY_CHECK") {
        const filteredRecs = recommendedChanges.filter((r) => r.trim().length > 0);
        if (filteredRecs.length === 0) throw new Error("Please provide at least one recommended change.");

        resultPayload = {
          verdict: archVerdict,
          critical_issues: criticalIssues.filter((i) => i.trim().length > 0),
          recommended_changes: filteredRecs,
          scaling_risks: scalingRisks.filter((r) => r.trim().length > 0),
          confidence: Number(archConfidence),
        };
      } else if (task?.task_type === "EXPERT_FACT_VERIFICATION") {
        if (!factExplanation.trim() || factExplanation.trim().length < 10) {
          throw new Error("Explanation must be at least 10 characters.");
        }

        resultPayload = {
          verdict: factVerdict,
          explanation: factExplanation.trim(),
          confidence: Number(factConfidence),
          source_notes: sourceNotes.trim() || undefined,
        };
      }

      const res = await fetch(`/api/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id: selectedWorkerId,
          result_payload: resultPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit result");
      }

      setSubmittedResult(data.result);
      await fetchTask();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-8 text-center max-w-xl mx-auto">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-200">Task Not Found</h2>
        <p className="text-slate-400 mt-2">{error || `No task exists with ID: ${taskId}`}</p>
        <a href="/" className="mt-6 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg">
          Return to Agent Sandbox
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Worker Persona Switcher Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-blue-900/40 text-blue-400 border border-blue-800/40">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Human Worker</div>
            <div className="text-sm font-medium text-white">
              {MOCK_WORKERS.find((w) => w.id === selectedWorkerId)?.name || selectedWorkerId}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-slate-400">Switch Mock Worker:</label>
          <select
            value={selectedWorkerId}
            onChange={(e) => setSelectedWorkerId(e.target.value)}
            disabled={task.status !== "OFFERED" && task.status !== "CREATED"}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          >
            {MOCK_WORKERS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-950/60 border border-red-800 text-red-200 p-4 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Task Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-slate-800 bg-gradient-to-b from-slate-800/40 to-transparent">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-mono uppercase px-2.5 py-1 rounded-md bg-blue-950 text-blue-400 border border-blue-800/50">
                {task.task_type}
              </span>
              <span
                className={`text-xs font-bold uppercase px-2.5 py-1 rounded-md ${
                  task.status === "COMPLETED"
                    ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                    : task.status === "IN_PROGRESS"
                    ? "bg-amber-950 text-amber-400 border border-amber-800"
                    : task.status === "ACCEPTED"
                    ? "bg-blue-950 text-blue-400 border border-blue-800"
                    : "bg-slate-800 text-slate-300 border border-slate-700"
                }`}
              >
                Status: {task.status}
              </span>
            </div>

            <div className="flex items-center space-x-6 text-sm">
              <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                <DollarSign className="w-4 h-4" />
                <span className="text-lg">${task.target_payout_usd.toFixed(2)}</span>
                <span className="text-xs text-slate-400 font-normal">Guaranteed Payout</span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-300">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>{task.sla_minutes} min SLA</span>
              </div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white tracking-tight">{task.title}</h1>
          <div className="mt-2 text-xs text-slate-400 font-mono">Task ID: {task.id}</div>
        </div>

        {/* Task Input Context */}
        <div className="p-6 md:p-8 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Task Brief & Inputs Provided by Agent
            </h3>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-sm text-slate-200 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(task.input_payload, null, 2)}
            </div>
          </div>

          {/* Action Step 1: Accept Task */}
          {(task.status === "OFFERED" || task.status === "CREATED") && (
            <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-white">Guaranteed Task Offer</h4>
                <p className="text-sm text-slate-400 mt-1">
                  Accept this task to lock in your guaranteed ${task.target_payout_usd.toFixed(2)} compensation.
                </p>
              </div>
              <button
                onClick={handleAccept}
                disabled={submitting}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center space-x-2 shrink-0 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>Accept Task (${task.target_payout_usd.toFixed(2)})</span>
              </button>
            </div>
          )}

          {/* Action Step 2: Start Task */}
          {task.status === "ACCEPTED" && (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-white">Task Assigned to You</h4>
                <p className="text-sm text-slate-400 mt-1">
                  Click start when you are ready to review and submit the structured output.
                </p>
              </div>
              <button
                onClick={handleStart}
                disabled={submitting}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl shadow-lg shadow-amber-600/30 transition-all flex items-center justify-center space-x-2 shrink-0 disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                <span>Start Working Now</span>
              </button>
            </div>
          )}

          {/* Action Step 3: Structured Submission Form */}
          {task.status === "IN_PROGRESS" && (
            <form onSubmit={handleSubmitResult} className="space-y-6 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <span>Submit Structured Outcome</span>
                </h3>
                <span className="text-xs text-blue-400 font-mono">Strict Machine-Readable Output</span>
              </div>

              {/* Task Type Specific Fields */}
              {task.task_type === "LANDING_PAGE_REVIEW" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Top Issues Identified (Array of strings)
                    </label>
                    {topIssues.map((issue, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={issue}
                          onChange={(e) => {
                            const copy = [...topIssues];
                            copy[idx] = e.target.value;
                            setTopIssues(copy);
                          }}
                          placeholder={`Issue #${idx + 1} (e.g. Hero value prop is confusing)`}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                        {topIssues.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setTopIssues(topIssues.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setTopIssues([...topIssues, ""])}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Issue</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Highest Impact Change (String)
                    </label>
                    <textarea
                      rows={2}
                      value={highestImpactChange}
                      onChange={(e) => setHighestImpactChange(e.target.value)}
                      placeholder="The single change that will yield the biggest conversion lift..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Conversion Blockers (Array of strings)
                    </label>
                    {conversionBlockers.map((blocker, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={blocker}
                          onChange={(e) => {
                            const copy = [...conversionBlockers];
                            copy[idx] = e.target.value;
                            setConversionBlockers(copy);
                          }}
                          placeholder={`Blocker #${idx + 1}`}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                        {conversionBlockers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setConversionBlockers(conversionBlockers.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setConversionBlockers([...conversionBlockers, ""])}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Blocker</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Confidence Score: {(landingConfidence * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.01"
                      value={landingConfidence}
                      onChange={(e) => setLandingConfidence(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              )}

              {task.task_type === "ARCHITECTURE_SANITY_CHECK" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Architectural Verdict
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {(["good", "acceptable", "risky"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setArchVerdict(v)}
                          className={`py-2 px-3 rounded-lg text-sm font-semibold border uppercase transition-all ${
                            archVerdict === v
                              ? v === "good"
                                ? "bg-emerald-950/80 border-emerald-500 text-emerald-300"
                                : v === "acceptable"
                                ? "bg-amber-950/80 border-amber-500 text-amber-300"
                                : "bg-red-950/80 border-red-500 text-red-300"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Recommended Changes (Array of strings)
                    </label>
                    {recommendedChanges.map((rec, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={rec}
                          onChange={(e) => {
                            const copy = [...recommendedChanges];
                            copy[idx] = e.target.value;
                            setRecommendedChanges(copy);
                          }}
                          placeholder={`Recommendation #${idx + 1}`}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                        {recommendedChanges.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRecommendedChanges(recommendedChanges.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setRecommendedChanges([...recommendedChanges, ""])}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Recommendation</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Critical Issues (Optional)
                    </label>
                    {criticalIssues.map((issue, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={issue}
                          onChange={(e) => {
                            const copy = [...criticalIssues];
                            copy[idx] = e.target.value;
                            setCriticalIssues(copy);
                          }}
                          placeholder={`Critical issue #${idx + 1}`}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                        {criticalIssues.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setCriticalIssues(criticalIssues.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCriticalIssues([...criticalIssues, ""])}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Issue</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Scaling Risks (Optional)
                    </label>
                    {scalingRisks.map((risk, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={risk}
                          onChange={(e) => {
                            const copy = [...scalingRisks];
                            copy[idx] = e.target.value;
                            setScalingRisks(copy);
                          }}
                          placeholder={`Scaling risk #${idx + 1}`}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                        {scalingRisks.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setScalingRisks(scalingRisks.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setScalingRisks([...scalingRisks, ""])}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Scaling Risk</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Confidence Score: {(archConfidence * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.01"
                      value={archConfidence}
                      onChange={(e) => setArchConfidence(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              )}

              {task.task_type === "EXPERT_FACT_VERIFICATION" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Verification Verdict
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {(["true", "false", "partial", "cannot_confirm"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setFactVerdict(v)}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold border uppercase transition-all ${
                            factVerdict === v
                              ? v === "true"
                                ? "bg-emerald-950/80 border-emerald-500 text-emerald-300"
                                : v === "false"
                                ? "bg-red-950/80 border-red-500 text-red-300"
                                : "bg-amber-950/80 border-amber-500 text-amber-300"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          {v.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Expert Explanation (String)
                    </label>
                    <textarea
                      rows={3}
                      value={factExplanation}
                      onChange={(e) => setFactExplanation(e.target.value)}
                      placeholder="Detailed factual rationale verifying or refuting the claim..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Source Notes / Citations (Optional)
                    </label>
                    <input
                      type="text"
                      value={sourceNotes}
                      onChange={(e) => setSourceNotes(e.target.value)}
                      placeholder="Direct documentation links, ISO specs, or verifiable publications..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Confidence Score: {(factConfidence * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.01"
                      value={factConfidence}
                      onChange={(e) => setFactConfidence(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>Submit Structured Result & Complete Task</span>
              </button>
            </form>
          )}

          {/* Action Step 4: Completion Confirmation */}
          {task.status === "COMPLETED" && (
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-400">
                <CheckCircle2 className="w-6 h-6 shrink-0" />
                <div>
                  <h4 className="text-base font-bold text-white">Task Successfully Completed</h4>
                  <p className="text-xs text-emerald-300/80">
                    Structured outcome delivered to the AI Agent. Guaranteed payout credited.
                  </p>
                </div>
              </div>

              {submittedResult && (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Delivered Structured Result
                  </div>
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-300 overflow-x-auto">
                    {JSON.stringify(submittedResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkerTaskPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      }
    >
      <WorkerTaskContent />
    </Suspense>
  );
}
