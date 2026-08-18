import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

const DEPARTMENTS = ['Engineering', 'Production', 'Warehouse', 'Regulatory Affairs', 'Finance', 'IT', 'Operations', 'Other'];

const STAKEHOLDERS = ['HSE and Facility', 'Operations', 'Engineering', 'Warehouse', 'Quality', 'IT', 'Customer Service', 'Abbott', 'Biotechnica'];

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

const STEPS = ['Basic Information', 'Project Overview', 'Business Value', 'Scope', 'Stakeholders', 'Budget', 'Risks & Constraints', 'URS Attachment'];

const val = (intake, key) => (intake && intake[key]) || '';

export default function IntakeWizard({ existing, onDone, onClose }) {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const intake = existing?.intake ? (() => { try { return JSON.parse(existing.intake); } catch { return null; } })() : null;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ursFile, setUrsFile] = useState(null);
  const [f, setF] = useState({
    name: existing?.name || '',
    sponsor: val(intake, 'Project Sponsor (requested by)'),
    owner: val(intake, 'Project Owner / Assigned') || user?.name || '',
    department: existing?.department || user?.department || '',
    request_date: val(intake, 'Date of Request') || today,
    expense_type: existing?.expense_type ? existing.expense_type.split(', ').filter(Boolean) : [],
    goal: existing?.description || '',
    background: val(intake, 'Background or context'),
    problem: val(intake, 'Problem it solves / opportunity'),
    importance: val(intake, 'Why is this project important'),
    outcomes: val(intake, 'Expected outcomes or benefits'),
    success_criteria: val(intake, 'Success criteria'),
    in_scope: val(intake, 'In scope'),
    out_of_scope: val(intake, 'Out of scope'),
    exec_sponsor: val(intake, 'Executive sponsor'),
    stakeholders: val(intake, 'Key stakeholders / teams involved') || [],
    beneficiaries: val(intake, 'Who will use or benefit'),
    risks: val(intake, 'Known risks or blockers') || [],
  });
  const [components, setComponents] = useState(
    existing?.budget_items?.length
      ? existing.budget_items.map((i) => ({ label: i.label, amount: String(i.amount) }))
      : [{ label: '', amount: '' }]
  );
  const validComponents = components.filter((c) => c.label.trim() && Number.isFinite(Number(c.amount)) && Number(c.amount) > 0);
  const budgetTotal = validComponents.reduce((s, c) => s + Number(c.amount), 0);
  const setComponent = (i, key, value) =>
    setComponents(components.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const hasUrs = !!existing?.urs_document_id;

  const REQUIRED_BY_STEP = [
    [['name', 'Project name'], ['sponsor', 'Project sponsor'], ['owner', 'Project owner'], ['department', 'Department'], ['request_date', 'Date of request'], ['expense_type', 'OpEx / CapEx']],
    [['goal', 'Goal or objective'], ['background', 'Background or context'], ['problem', 'Problem / opportunity']],
    [['importance', 'Why this project is important']],
    [],
    [['exec_sponsor', 'Project / executive sponsor'], ['stakeholders', 'Key stakeholders']],
    [],
    [],
    [],
  ];

  // Resuming a draft reopens at the step it was saved on (stored as _step),
  // or failing that at the first step that still requires filling in.
  const [step, setStep] = useState(() => {
    if (existing?.approval_status !== 'draft') return 0;
    const saved = Number(intake?._step);
    if (Number.isInteger(saved) && saved >= 0 && saved < STEPS.length) return saved;
    for (let s = 0; s < REQUIRED_BY_STEP.length; s++) {
      for (const [key] of REQUIRED_BY_STEP[s]) {
        const v = f[key];
        if (!v || (Array.isArray(v) && v.length === 0)) return s;
      }
    }
    return STEPS.length - 1; // everything required is filled — go to the URS step
  });

  const validate = () => {
    for (const [key, label] of REQUIRED_BY_STEP[step]) {
      const v = f[key];
      if (!v || (Array.isArray(v) && v.length === 0)) return `${label} is required`;
    }
    return '';
  };

  const buildPayload = (draft) => ({
    name: f.name,
    description: f.goal,
    department: f.department,
    expense_type: f.expense_type.join(', '),
    budget: budgetTotal > 0 ? budgetTotal : null,
    budget_components: validComponents.map((c) => ({ label: c.label.trim(), amount: Number(c.amount) })),
    draft,
    intake: {
      'Project Sponsor (requested by)': f.sponsor,
      'Project Owner / Assigned': f.owner,
      'Department / Team': f.department,
      'Date of Request': f.request_date,
      'OpEx or CapEx': f.expense_type.join(', '),
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
      'Known risks or blockers': f.risks,
      // Drafts remember which step they were saved on so Resume reopens there.
      ...(draft ? { _step: step } : {}),
    },
  });

  const persist = async (draft) => {
    const payload = buildPayload(draft);
    const project = existing
      ? await api(`/projects/${existing.id}`, { method: 'PUT', body: payload })
      : await api('/projects', { method: 'POST', body: payload });
    if (ursFile) {
      const fd = new FormData();
      fd.append('file', ursFile);
      await api(`/projects/${project.id}/documents?urs=1`, { method: 'POST', formData: fd });
    }
    return project;
  };

  const saveDraft = async () => {
    if (!f.name.trim()) return setErr('Give the project a name before saving a draft');
    setErr('');
    setBusy(true);
    try {
      const project = await persist(true);
      onDone(project, true);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  const next = () => {
    const e = validate();
    if (e) return setErr(e);
    setErr('');
    setStep(step + 1);
  };

  const submit = async () => {
    if (!ursFile && !hasUrs) return setErr('The URS document is required to submit the form for approval');
    setErr('');
    setBusy(true);
    try {
      const project = await persist(false);
      onDone(project, false);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <h2>{existing ? 'Project Form' : 'New Project Intake'}</h2>
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
            <div className="field"><label>Expense type — select all that apply *</label>
              <div className="choice-list">
                <label className={`choice${f.expense_type.includes('OpEx') ? ' selected' : ''}`}>
                  <input type="checkbox" checked={f.expense_type.includes('OpEx')} onChange={() => toggle('expense_type', 'OpEx')} />
                  <span><b>OpEx</b> — day-to-day operational or maintenance cost</span>
                </label>
                <label className={`choice${f.expense_type.includes('CapEx') ? ' selected' : ''}`}>
                  <input type="checkbox" checked={f.expense_type.includes('CapEx')} onChange={() => toggle('expense_type', 'CapEx')} />
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
          <div className="field">
            <label>Budget breakdown — list the components that make up the cost</label>
            <div className="faint" style={{ margin: '4px 0 12px' }}>
              Add each component with its estimated price. The total is calculated automatically.
            </div>
            {components.map((c, i) => (
              <div key={i} className="task-add" style={{ marginTop: i === 0 ? 0 : 8 }}>
                <input value={c.label} onChange={(e) => setComponent(i, 'label', e.target.value)}
                  placeholder={`Component ${i + 1}, e.g. Machinery supply`} autoFocus={i === 0} />
                <input type="number" min="0" step="0.01" value={c.amount}
                  onChange={(e) => setComponent(i, 'amount', e.target.value)} placeholder="£" style={{ maxWidth: 160, flex: 'none' }} />
                {components.length > 1 && (
                  <button type="button" className="btn small danger"
                    onClick={() => setComponents(components.filter((_, idx) => idx !== i))}>✕</button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <button type="button" className="btn small" onClick={() => setComponents([...components, { label: '', amount: '' }])}>
                + Add component
              </button>
              <div style={{ fontWeight: 800 }}>
                Total: {budgetTotal > 0 ? `£${budgetTotal.toLocaleString('en-GB')}` : '—'}
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
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

        {step === 7 && (
          <div className="field">
            <label>User Requirement Specification (URS) — required *</label>
            <div className="faint" style={{ margin: '4px 0 12px' }}>
              Attach the URS document for this project. Supplier quotes will be assessed against it.
              {hasUrs && !ursFile && ' A URS is already attached to this project — upload a file only if you want to replace it.'}
            </div>
            <input type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={(e) => setUrsFile(e.target.files[0] || null)} />
            {ursFile && <div className="muted" style={{ marginTop: 8 }}>Selected: {ursFile.name}</div>}
          </div>
        )}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={saveDraft}>Save & finish later</button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {step > 0 && <button type="button" className="btn" onClick={() => { setErr(''); setStep(step - 1); }}>Back</button>}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn primary" onClick={next}>Next</button>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
