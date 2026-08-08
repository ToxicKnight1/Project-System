import React, { useState } from 'react';
import { useAuth } from '../App.jsx';

const DEPARTMENTS = ['Engineering', 'Production', 'Warehouse', 'Regulatory Affairs', 'Finance', 'IT', 'Operations', 'Other'];

const STAKEHOLDERS = ['HSE and Facility', 'Operations', 'Engineering', 'Warehouse', 'Quality', 'IT', 'Customer Service', 'Abbott', 'Biotechnica'];

const PRIORITIES = [
  ['critical', 'Critical — Immediate business impact / production issue'],
  ['urgent_important', 'Urgent & Important — High priority with significant business need'],
  ['urgent_low', 'Urgent but Lower Impact — Time-sensitive but lower business impact'],
  ['important_not_urgent', 'Important but Not Urgent — Valuable improvement that can be planned'],
  ['desirable', 'Desirable — Optional enhancement or future improvement'],
];

const RISKS = [
  'Lack of required approvals or dependencies',
  'Limited budget or funding constraints',
  'Resource availability issues (team not available)',
  'Technical limitations or system compatibility issues',
  'Waiting on input from other teams/vendors',
  'Tight deadlines or unrealistic timelines',
  'Data availability or quality issues',
  'Security, compliance, or legal concerns',
  'Infrastructure or environment readiness',
  'Any external dependencies',
];

const STEPS = ['Basic Information', 'Project Overview', 'Business Value', 'Scope', 'Stakeholders', 'Timeline', 'Budget', 'Risks & Constraints'];

// Parse "180k", "£25,000", "1.2m" etc. into a number for the budget column.
function parseBudget(text) {
  if (!text) return null;
  const m = String(text).toLowerCase().replace(/[£$,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|m)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1000;
  if (m[2] === 'm') n *= 1000000;
  return Number.isFinite(n) ? n : null;
}

export default function IntakeWizard({ onSave, onClose }) {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', sponsor: '', owner: user?.name || '', department: user?.department || '', request_date: today, expense_type: '',
    goal: '', background: '', problem: '',
    importance: '', outcomes: '', success_criteria: '',
    in_scope: '', out_of_scope: '',
    exec_sponsor: '', stakeholders: [], beneficiaries: '',
    priority: '', target_date: '',
    estimated_budget: '',
    risks: [],
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });

  const REQUIRED_BY_STEP = [
    [['name', 'Project name'], ['sponsor', 'Project sponsor'], ['owner', 'Project owner'], ['department', 'Department'], ['request_date', 'Date of request'], ['expense_type', 'OpEx or CapEx']],
    [['goal', 'Goal or objective'], ['background', 'Background or context'], ['problem', 'Problem / opportunity']],
    [['importance', 'Why this project is important']],
    [],
    [['exec_sponsor', 'Project / executive sponsor'], ['stakeholders', 'Key stakeholders']],
    [['priority', 'Priority level']],
    [],
    [],
  ];

  const validate = () => {
    for (const [key, label] of REQUIRED_BY_STEP[step]) {
      const v = f[key];
      if (!v || (Array.isArray(v) && v.length === 0)) return `${label} is required`;
    }
    return '';
  };

  const next = () => {
    const e = validate();
    if (e) return setErr(e);
    setErr('');
    setStep(step + 1);
  };

  const submit = async () => {
    const e = validate();
    if (e) return setErr(e);
    setErr('');
    setBusy(true);
    try {
      await onSave({
        name: f.name,
        description: f.goal,
        status: 'planning',
        start_date: f.request_date || null,
        due_date: f.target_date || null,
        budget: parseBudget(f.estimated_budget),
        department: f.department,
        expense_type: f.expense_type,
        priority: f.priority,
        intake: {
          'Project Sponsor (requested by)': f.sponsor,
          'Project Owner / Assigned': f.owner,
          'Department / Team': f.department,
          'Date of Request': f.request_date,
          'OpEx or CapEx': f.expense_type,
          'Goal / Objective': f.goal,
          'Background or context': f.background,
          'Problem it solves / opportunity': f.problem,
          'Why is this project important': f.importance,
          'Expected outcomes or benefits': f.outcomes,
          'Success criteria': f.success_criteria,
          'In scope': f.in_scope,
          'Out of scope': f.out_of_scope,
          'Executive sponsor': f.exec_sponsor,
          'Key stakeholders / teams involved': f.stakeholders,
          'Who will use or benefit': f.beneficiaries,
          'Priority level': f.priority,
          'Estimated budget / cost': f.estimated_budget,
          'Known risks or blockers': f.risks,
        },
      });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <h2>New Project Intake</h2>
          <div className="wizard-progress">
            <span>Step {step + 1} of {STEPS.length} — <b>{STEPS[step]}</b></span>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
          </div>
        </div>
        {err && <div className="form-err">{err}</div>}

        {step === 0 && (
          <>
            <div className="field"><label>Project name *</label><input value={f.name} onChange={set('name')} autoFocus /></div>
            <div className="form-row">
              <div className="field"><label>Project sponsor (who is requesting it?) *</label><input value={f.sponsor} onChange={set('sponsor')} /></div>
              <div className="field"><label>Project owner / assigned *</label><input value={f.owner} onChange={set('owner')} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Department / team *</label>
                <select value={f.department} onChange={set('department')}>
                  <option value="">Select department…</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field"><label>Date of request *</label><input type="date" value={f.request_date} onChange={set('request_date')} /></div>
            </div>
            <div className="field"><label>Is this primarily an Operating Expense (OpEx) or a Capital Expense (CapEx)? *</label>
              <div className="choice-list">
                <label className={`choice${f.expense_type === 'OpEx' ? ' selected' : ''}`}>
                  <input type="radio" name="expense" checked={f.expense_type === 'OpEx'} onChange={() => setF({ ...f, expense_type: 'OpEx' })} />
                  <span><b>OpEx</b> — day-to-day operational or maintenance cost</span>
                </label>
                <label className={`choice${f.expense_type === 'CapEx' ? ' selected' : ''}`}>
                  <input type="radio" name="expense" checked={f.expense_type === 'CapEx'} onChange={() => setF({ ...f, expense_type: 'CapEx' })} />
                  <span><b>CapEx</b> — new investment or major upgrade with long-term value</span>
                </label>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="field"><label>What is the goal or objective of this project? *</label>
              <textarea rows={3} value={f.goal} onChange={set('goal')} placeholder="A short description of what this project aims to achieve." autoFocus />
            </div>
            <div className="field"><label>Background or context *</label>
              <textarea rows={3} value={f.background} onChange={set('background')} placeholder="What led to this project? Any history or current challenges?" />
            </div>
            <div className="field"><label>What problem does it solve? / What opportunity does it address? *</label>
              <textarea rows={2} value={f.problem} onChange={set('problem')} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="field"><label>Why is this project important? *</label>
              <textarea rows={3} value={f.importance} onChange={set('importance')} autoFocus />
            </div>
            <div className="field"><label>What are the expected outcomes or benefits?</label>
              <textarea rows={3} value={f.outcomes} onChange={set('outcomes')} placeholder="Revenue, cost savings, compliance, customer satisfaction, etc." />
            </div>
            <div className="field"><label>What are the success criteria?</label>
              <textarea rows={2} value={f.success_criteria} onChange={set('success_criteria')} placeholder="How will we know the project was successful?" />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="field"><label>In scope</label>
              <textarea rows={3} value={f.in_scope} onChange={set('in_scope')} placeholder="What will be included?" autoFocus />
            </div>
            <div className="field"><label>Out of scope</label>
              <textarea rows={3} value={f.out_of_scope} onChange={set('out_of_scope')} placeholder="What will explicitly not be part of this project?" />
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="field"><label>Project sponsor / executive sponsor *</label><input value={f.exec_sponsor} onChange={set('exec_sponsor')} autoFocus /></div>
            <div className="field"><label>Key stakeholders / teams involved *</label>
              <div className="choice-grid">
                {STAKEHOLDERS.map((s) => (
                  <label key={s} className={`choice${f.stakeholders.includes(s) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={f.stakeholders.includes(s)} onChange={() => toggle('stakeholders', s)} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field"><label>Who will use or benefit from this project?</label><input value={f.beneficiaries} onChange={set('beneficiaries')} /></div>
          </>
        )}

        {step === 5 && (
          <>
            <div className="field"><label>How would you classify this project? (priority level) *</label>
              <div className="choice-list">
                {PRIORITIES.map(([v, label]) => (
                  <label key={v} className={`choice${f.priority === v ? ' selected' : ''}`}>
                    <input type="radio" name="priority" checked={f.priority === v} onChange={() => setF({ ...f, priority: v })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field"><label>Target / required completion date</label><input type="date" value={f.target_date} onChange={set('target_date')} /></div>
          </>
        )}

        {step === 6 && (
          <div className="field"><label>Estimated budget / cost (if known)</label>
            <input value={f.estimated_budget} onChange={set('estimated_budget')} placeholder="e.g. £180k" autoFocus />
          </div>
        )}

        {step === 7 && (
          <div className="field"><label>Known risks or blockers</label>
            <div className="choice-grid">
              {RISKS.map((r) => (
                <label key={r} className={`choice${f.risks.includes(r) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={f.risks.includes(r)} onChange={() => toggle('risks', r)} />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <div style={{ display: 'flex', gap: 10 }}>
            {step > 0 && <button type="button" className="btn" onClick={() => { setErr(''); setStep(step - 1); }}>Back</button>}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn primary" onClick={next}>Next</button>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Submit & create project'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
