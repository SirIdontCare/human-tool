"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Terminal,
  Activity,
  Zap,
  ExternalLink,
  Shield,
  Clock,
  Layers,
  Code2,
  RefreshCw,
} from "lucide-react";
import { TASK_CATALOGUE } from "@/lib/catalogue";

export default function AgentSandboxPage() {
  const [selectedType, setSelectedType] = useState<string>("LANDING_PAGE_REVIEW");
  const [inputPayload, setInputPayload] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flow State
  const [activeStep, setActiveStep] = useState<number>(1);
  const [quoteData, setQuoteData] = useState<any>(null);
  const [taskData, setTaskData] = useState<any>(null);
  const [resultData, setResultData] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);

  // Initialize input payload when type changes
  useEffect(() => {
    const item = TASK_CATALOGUE[selectedType];
    if (item) {
      setInputPayload(JSON.stringify(item.example_input, null, 2));
    }
  }, [selectedType]);

  // Fetch events periodically
  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
  }, []);

  // Step 1: Agent requests quote
  const handleRequestQuote = async () => {
    setError(null);
    setLoading(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(inputPayload);
      } catch (err) {
        throw new Error("Invalid JSON input payload");
      }

      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_type: selectedType,
          input_payload: parsedPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request quote");

      setQuoteData(data);
      setActiveStep(2);
      await fetchEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Agent creates task from quote
  const handleCreateTask = async () => {
    if (!quoteData?.quote_id) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: quoteData.quote_id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create task");

      setTaskData(data);
      setActiveStep(3);
      await fetchEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 5: Agent retrieves result
  const handleRetrieveResult = async () => {
    if (!taskData?.task_id) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskData.task_id}/result`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Failed to retrieve result");

      setResultData(data);
      setActiveStep(5);
      await fetchEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // One-Click Automated 5-Step Simulation
  const handleRunFullSimulation = async () => {
    setError(null);
    setLoading(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(inputPayload);
      } catch (err) {
        throw new Error("Invalid JSON input payload");
      }

      // 1. Quote
      const qRes = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: selectedType, input_payload: parsedPayload }),
      });
      const q = await qRes.json();
      if (!qRes.ok) throw new Error(q.error);
      setQuoteData(q);

      // 2. Task
      const tRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: q.quote_id }),
      });
      const t = await tRes.json();
      if (!tRes.ok) throw new Error(t.error);
      setTaskData(t);

      // 3. Human Accept
      const workerId =
        selectedType === "LANDING_PAGE_REVIEW"
          ? "w_alex_ux"
          : selectedType === "ARCHITECTURE_SANITY_CHECK"
          ? "w_sam_arch"
          : "w_elena_fact";

      const aRes = await fetch(`/api/tasks/${t.task_id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
      if (!aRes.ok) throw new Error("Accept failed");

      // 4. Start
      await fetch(`/api/tasks/${t.task_id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });

      // 5. Submit Mock Structured Result
      let mockResult: any = {};
      if (selectedType === "LANDING_PAGE_REVIEW") {
        mockResult = {
          top_issues: [
            "Headline fails to communicate unique value in first 3 seconds",
            "CTA button is below the fold on mobile viewports",
            "Missing clear developer-oriented TypeScript examples",
          ],
          highest_impact_change: "Add an instant interactive playground above the fold",
          conversion_blockers: ["Forced registration before viewing documentation"],
          confidence: 0.96,
        };
      } else if (selectedType === "ARCHITECTURE_SANITY_CHECK") {
        mockResult = {
          verdict: "acceptable",
          critical_issues: ["Connection exhaustion risk under peak 10k rps without Neon pooling adapter"],
          recommended_changes: [
            "Implement PgBouncer or Neon serverless connection pooler",
            "Cache task catalogue lookups in Redis with 10m TTL",
          ],
          scaling_risks: ["Single-region latency for European agents"],
          confidence: 0.92,
        };
      } else {
        mockResult = {
          verdict: "true",
          explanation:
            "Verified via Neon technical specifications. Compute instances branch and spin up within 500ms using Copy-on-Write storage layers.",
          confidence: 0.98,
          source_notes: "Neon Architecture whitepaper (2025/2026 edition)",
        };
      }

      const sRes = await fetch(`/api/tasks/${t.task_id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId, result_payload: mockResult }),
      });
      if (!sRes.ok) throw new Error("Submit failed");

      // 6. Retrieve
      const rRes = await fetch(`/api/tasks/${t.task_id}/result`);
      const r = await rRes.json();
      if (!rRes.ok) throw new Error(r.error);

      setResultData(r);
      setActiveStep(5);
      await fetchEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setActiveStep(1);
    setQuoteData(null);
    setTaskData(null);
    setResultData(null);
    setError(null);
  };

  const currentCatalogueItem = TASK_CATALOGUE[selectedType];

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950/50 via-slate-900 to-slate-950 border border-slate-800 p-8 shadow-2xl">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-900/40 text-blue-400 text-xs font-semibold border border-blue-700/40">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Agent-First Human Capability Protocol</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Human Capability as Infrastructure for AI Agents
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            AI agents buy verified outcomes, human judgment, and expert verification programmatically like an API.
            Predictable fixed pricing, machine-readable structured results, and sub-hour SLAs.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={handleRunFullSimulation}
              disabled={loading}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-600/30 flex items-center space-x-2 transition-all disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              <span>{loading ? "Running 5-Step Simulation..." : "Run 1-Click End-to-End Test"}</span>
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-medium text-sm rounded-xl border border-slate-700 transition-all flex items-center space-x-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset State</span>
            </button>
          </div>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="bg-red-950/60 border border-red-800 text-red-200 p-4 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 font-bold hover:text-red-200 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* 2-Column Layout: Interactive Sandbox & Live Events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Flow Stepper & Action Card (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Step Progression Visualizer */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              {[
                { num: 1, label: "Quote" },
                { num: 2, label: "Task" },
                { num: 3, label: "Accept" },
                { num: 4, label: "Submit" },
                { num: 5, label: "Result" },
              ].map((s) => (
                <div key={s.num} className="flex items-center space-x-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-mono ${
                      activeStep === s.num
                        ? "bg-blue-600 text-white font-bold ring-2 ring-blue-400"
                        : activeStep > s.num
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {activeStep > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                  </div>
                  <span className={activeStep === s.num ? "text-white" : "text-slate-400"}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Task Type Selector */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              1. Select Task Type from Catalogue
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.values(TASK_CATALOGUE).map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setSelectedType(item.code)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    selectedType === item.code
                      ? "bg-blue-950/60 border-blue-500 shadow-md shadow-blue-500/20"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="text-xs font-mono text-blue-400 font-bold">${item.customer_price_usd}</div>
                  <div className="text-sm font-semibold text-white mt-1">{item.title}</div>
                  <div className="text-xs text-slate-400 mt-1">{item.default_sla_minutes} min SLA</div>
                </button>
              ))}
            </div>

            {/* Input Payload Editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Agent Input Payload (JSON)
                </label>
                <span className="text-xs text-slate-500 font-mono">Validated via Zod</span>
              </div>
              <textarea
                rows={5}
                value={inputPayload}
                onChange={(e) => setInputPayload(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-wrap gap-3">
              {activeStep === 1 && (
                <button
                  onClick={handleRequestQuote}
                  disabled={loading}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
                >
                  <Terminal className="w-4 h-4" />
                  <span>Call POST /api/quotes</span>
                </button>
              )}

              {activeStep === 2 && quoteData && (
                <div className="w-full space-y-3">
                  <div className="p-3 bg-blue-950/40 border border-blue-800/40 rounded-xl text-xs font-mono text-blue-300">
                    Quote Received: ${quoteData.customer_price_usd} USD | SLA: {quoteData.estimated_minutes}m | ID:{" "}
                    {quoteData.quote_id}
                  </div>
                  <button
                    onClick={handleCreateTask}
                    disabled={loading}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 transition-all"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Accept Quote & Call POST /api/tasks</span>
                  </button>
                </div>
              )}

              {(activeStep === 3 || activeStep === 4) && taskData && (
                <div className="w-full space-y-4">
                  <div className="p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-xl space-y-2">
                    <div className="text-xs font-mono text-emerald-400 font-semibold">
                      Task Created: {taskData.task_id} (Status: {taskData.status})
                    </div>
                    <p className="text-xs text-slate-300">
                      Task has been offered to qualified human experts. Open the worker execution interface to accept,
                      review, and submit.
                    </p>
                    <a
                      href={`/tasks/${taskData.task_id}`}
                      target="_blank"
                      className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-lg transition-all"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Worker Task Page in New Tab</span>
                    </a>
                  </div>

                  <button
                    onClick={handleRetrieveResult}
                    disabled={loading}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm rounded-xl border border-slate-700 flex items-center justify-center space-x-2 transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Check & Retrieve Result (GET /api/tasks/{taskData.task_id}/result)</span>
                  </button>
                </div>
              )}

              {activeStep === 5 && resultData && (
                <div className="w-full space-y-3">
                  <div className="p-4 bg-emerald-950/50 border border-emerald-700 rounded-xl">
                    <div className="text-sm font-bold text-emerald-300 flex items-center space-x-2 mb-2">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Structured Result Delivered to AI Agent</span>
                    </div>
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
                      {JSON.stringify(resultData, null, 2)}
                    </pre>
                  </div>
                  <button
                    onClick={handleReset}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-xl"
                  >
                    Start Another Task
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Live Event Log Stream (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col h-[620px]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white tracking-wide">Live Lifecycle Event Stream</h3>
              </div>
              <span className="text-xs font-mono text-slate-500">{events.length} events logged</span>
            </div>

            <div className="flex-1 overflow-y-auto pt-4 space-y-3 pr-1">
              {events.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs font-mono">
                  No events recorded yet. Run a simulation or quote above!
                </div>
              ) : (
                events.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                          evt.event_type.includes("completed") || evt.event_type.includes("retrieved")
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : evt.event_type.includes("accepted") || evt.event_type.includes("started")
                            ? "bg-blue-950 text-blue-400 border border-blue-800"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {evt.event_type}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(evt.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-400 truncate">
                      {evt.entity_type}: {evt.entity_id}
                    </div>
                    {evt.payload && Object.keys(evt.payload).length > 0 && (
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-900/60 p-1.5 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(evt.payload)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
