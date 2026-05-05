import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const initialData = {
  subjects: [
    {
      id: uid(),
      name: "Calculus",
      difficulty: 4,
      currentGrade: 72,
      gradeComponents: [{ name: "Midterm", max: 30, earned: 20 }]
    }
  ],
  classes: [],
  assignments: [],
  exams: [],
  commitments: [],
  holidays: []
};

const initialPreferences = {
  scheduleMode: "next7",
  customStartDate: today(),
  customEndDate: today(),
  semesterEnd: "",
  studyWindowStart: "06:00",
  studyWindowEnd: "23:00",
  preferredStudyTime: "any",
  preferredSessionMinutes: 60,
  minimumSessionMinutes: 30,
  maximumSessionMinutes: 180,
  maxHoursPerDay: 5,
  restDays: [],
  breakEnabled: true,
  breakPlacement: "after",
  breakMinutes: 10
};

function App() {
  const [data, setData] = usePersistentState("ai-study-planner-data", initialData);
  const [preferences, setPreferences] = usePersistentState("ai-study-planner-preferences", initialPreferences);
  const [schedule, setSchedule] = usePersistentState("ai-study-planner-schedule", []);
  const [warnings, setWarnings] = useState([]);
  const [status, setStatus] = useState("");

  const inputWarnings = useMemo(() => validateInput(data), [data]);

  async function generateSchedule() {
    setStatus("Generating...");
    setWarnings([]);
    try {
      const response = await fetch("/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, preferences })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Schedule request failed.");
      setSchedule(payload.schedule || []);
      setWarnings(payload.warnings || []);
      setStatus(payload.source === "openai" ? "Generated with OpenAI" : "Generated with local fallback");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function updateCollection(collection, id, patch) {
    setData((current) => ({
      ...current,
      [collection]: current[collection].map((item) => item.id === id ? { ...item, ...patch } : item)
    }));
  }

  function addItem(collection, item) {
    setData((current) => ({ ...current, [collection]: [...current[collection], { id: uid(), ...item }] }));
  }

  function removeItem(collection, id) {
    setData((current) => ({ ...current, [collection]: current[collection].filter((item) => item.id !== id) }));
  }

  return (
    <main className="app">
      <header className="top">
        <div>
          <h1>AI Study Planner</h1>
          <p>React + Node planner with OpenAI scheduling and server-side conflict repair.</p>
        </div>
        <button className="primary" onClick={generateSchedule} disabled={inputWarnings.length > 0}>
          Generate schedule
        </button>
      </header>

      {inputWarnings.length > 0 && (
        <section className="notice danger">
          {inputWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        </section>
      )}
      {(warnings.length > 0 || status) && (
        <section className="notice">
          {status && <strong>{status}</strong>}
          {warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </section>
      )}

      <section className="grid">
        <PlannerPreferences preferences={preferences} setPreferences={setPreferences} />
        <Subjects data={data} addItem={addItem} updateCollection={updateCollection} removeItem={removeItem} />
      </section>

      <section className="grid">
        <BusyTimes
          title="Classes"
          collection="classes"
          subjects={data.subjects}
          items={data.classes}
          addItem={addItem}
          updateCollection={updateCollection}
          removeItem={removeItem}
        />
        <BusyTimes
          title="Commitments"
          collection="commitments"
          subjects={data.subjects}
          items={data.commitments}
          addItem={addItem}
          updateCollection={updateCollection}
          removeItem={removeItem}
        />
      </section>

      <section className="grid">
        <Deadlines
          title="Assignments"
          collection="assignments"
          subjects={data.subjects}
          items={data.assignments}
          addItem={addItem}
          updateCollection={updateCollection}
          removeItem={removeItem}
        />
        <Deadlines
          title="Exams"
          collection="exams"
          subjects={data.subjects}
          items={data.exams}
          addItem={addItem}
          updateCollection={updateCollection}
          removeItem={removeItem}
          exam
        />
      </section>

      <Holidays data={data} setData={setData} />
      <ScheduleEditor schedule={schedule} setSchedule={setSchedule} subjects={data.subjects} />
    </main>
  );
}

function PlannerPreferences({ preferences, setPreferences }) {
  const update = (patch) => setPreferences((current) => ({ ...current, ...patch }));
  return (
    <section className="panel">
      <h2>Interactive questions</h2>
      <label>
        Schedule length
        <select value={preferences.scheduleMode} onChange={(event) => update({ scheduleMode: event.target.value })}>
          <option value="today">Today</option>
          <option value="next7">Next 7 days</option>
          <option value="nearest">Until nearest deadline</option>
          <option value="semester">Whole semester</option>
          <option value="custom">Custom date range</option>
        </select>
      </label>
      {preferences.scheduleMode === "custom" && (
        <div className="row">
          <label>Start <input type="date" value={preferences.customStartDate} onChange={(e) => update({ customStartDate: e.target.value })} /></label>
          <label>End <input type="date" value={preferences.customEndDate} onChange={(e) => update({ customEndDate: e.target.value })} /></label>
        </div>
      )}
      {preferences.scheduleMode === "semester" && (
        <label>Semester end <input type="date" value={preferences.semesterEnd} onChange={(e) => update({ semesterEnd: e.target.value })} /></label>
      )}
      <div className="row">
        <label>Study from <input type="time" value={preferences.studyWindowStart} onChange={(e) => update({ studyWindowStart: e.target.value })} /></label>
        <label>Study until <input type="time" value={preferences.studyWindowEnd} onChange={(e) => update({ studyWindowEnd: e.target.value })} /></label>
      </div>
      <label>
        Preferred study time
        <select value={preferences.preferredStudyTime} onChange={(e) => update({ preferredStudyTime: e.target.value })}>
          <option value="any">Any available time</option>
          <option value="morning">Early morning</option>
          <option value="evening">Evening</option>
        </select>
      </label>
      <div className="row">
        <label>Preferred session <input type="number" value={preferences.preferredSessionMinutes} onChange={(e) => update({ preferredSessionMinutes: e.target.value })} /></label>
        <label>Minimum session <input type="number" value={preferences.minimumSessionMinutes} onChange={(e) => update({ minimumSessionMinutes: e.target.value })} /></label>
        <label>Maximum session <input type="number" value={preferences.maximumSessionMinutes} onChange={(e) => update({ maximumSessionMinutes: e.target.value })} /></label>
      </div>
      <label>Max study hours per day <input type="number" step="0.5" value={preferences.maxHoursPerDay} onChange={(e) => update({ maxHoursPerDay: e.target.value })} /></label>
      <fieldset>
        <legend>Preferred rest days</legend>
        <div className="chips">
          {days.map((day, index) => (
            <button
              type="button"
              className={preferences.restDays.includes(index) ? "chip active" : "chip"}
              key={day}
              onClick={() => update({ restDays: toggle(preferences.restDays, index) })}
            >
              {day}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Breaks</legend>
        <label className="inline"><input type="checkbox" checked={preferences.breakEnabled} onChange={(e) => update({ breakEnabled: e.target.checked })} /> Add breaks</label>
        {preferences.breakEnabled && (
          <div className="row">
            <label>
              Placement
              <select value={preferences.breakPlacement} onChange={(e) => update({ breakPlacement: e.target.value })}>
                <option value="after">After each session</option>
                <option value="during">During long sessions</option>
              </select>
            </label>
            <label>Break minutes <input type="number" value={preferences.breakMinutes} onChange={(e) => update({ breakMinutes: e.target.value })} /></label>
          </div>
        )}
      </fieldset>
    </section>
  );
}

function Subjects({ data, addItem, updateCollection, removeItem }) {
  return (
    <section className="panel">
      <PanelHeader title="Subjects" onAdd={() => addItem("subjects", { name: "New subject", difficulty: 3, currentGrade: 80, gradeComponents: [] })} />
      {data.subjects.map((subject) => (
        <article className="item" key={subject.id}>
          <input value={subject.name} onChange={(e) => updateCollection("subjects", subject.id, { name: e.target.value })} />
          <div className="row">
            <label>Difficulty <input type="number" min="1" max="5" value={subject.difficulty} onChange={(e) => updateCollection("subjects", subject.id, { difficulty: e.target.value })} /></label>
            <label>Current grade <input type="number" min="0" max="100" value={subject.currentGrade ?? ""} onChange={(e) => updateCollection("subjects", subject.id, { currentGrade: e.target.value })} /></label>
          </div>
          <button className="ghost" onClick={() => removeItem("subjects", subject.id)}>Remove</button>
        </article>
      ))}
    </section>
  );
}

function BusyTimes({ title, collection, subjects, items, addItem, updateCollection, removeItem }) {
  const firstSubjectId = subjects[0]?.id || "";
  return (
    <section className="panel">
      <PanelHeader
        title={title}
        onAdd={() => addItem(collection, {
          subjectId: collection === "classes" ? firstSubjectId : "",
          name: collection === "classes" ? "Class" : "Commitment",
          days: [1],
          startTime: "09:00",
          endTime: "10:00"
        })}
      />
      {items.map((item) => (
        <article className="item" key={item.id}>
          {collection === "classes" ? (
            <select value={item.subjectId} onChange={(e) => updateCollection(collection, item.id, { subjectId: e.target.value })}>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          ) : (
            <input value={item.name} onChange={(e) => updateCollection(collection, item.id, { name: e.target.value })} />
          )}
          <DayPicker value={item.days || []} onChange={(daysValue) => updateCollection(collection, item.id, { days: daysValue })} />
          <div className="row">
            <label>Start <input type="time" value={item.startTime} onChange={(e) => updateCollection(collection, item.id, { startTime: e.target.value })} /></label>
            <label>End <input type="time" value={item.endTime} onChange={(e) => updateCollection(collection, item.id, { endTime: e.target.value })} /></label>
          </div>
          <button className="ghost" onClick={() => removeItem(collection, item.id)}>Remove</button>
        </article>
      ))}
    </section>
  );
}

function Deadlines({ title, collection, subjects, items, addItem, updateCollection, removeItem, exam = false }) {
  const firstSubjectId = subjects[0]?.id || "";
  return (
    <section className="panel">
      <PanelHeader
        title={title}
        onAdd={() => addItem(collection, {
          subjectId: firstSubjectId,
          title: exam ? "Exam" : "Assignment",
          due: today(),
          date: today(),
          time: "09:00"
        })}
      />
      {items.map((item) => (
        <article className="item" key={item.id}>
          <select value={item.subjectId} onChange={(e) => updateCollection(collection, item.id, { subjectId: e.target.value })}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          <input value={item.title} onChange={(e) => updateCollection(collection, item.id, { title: e.target.value })} />
          <div className="row">
            <label>{exam ? "Date" : "Due"} <input type="date" value={exam ? item.date : item.due} onChange={(e) => updateCollection(collection, item.id, exam ? { date: e.target.value } : { due: e.target.value })} /></label>
            {exam && <label>Time <input type="time" value={item.time} onChange={(e) => updateCollection(collection, item.id, { time: e.target.value })} /></label>}
          </div>
          <button className="ghost" onClick={() => removeItem(collection, item.id)}>Remove</button>
        </article>
      ))}
    </section>
  );
}

function Holidays({ data, setData }) {
  const [date, setDate] = useState(today());
  return (
    <section className="panel">
      <h2>Holidays</h2>
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={() => setData((current) => ({ ...current, holidays: [...new Set([...current.holidays, date])] }))}>Add holiday</button>
      </div>
      <div className="chips">
        {data.holidays.map((holiday) => (
          <button className="chip active" key={holiday} onClick={() => setData((current) => ({ ...current, holidays: current.holidays.filter((item) => item !== holiday) }))}>
            {holiday}
          </button>
        ))}
      </div>
    </section>
  );
}

function ScheduleEditor({ schedule, setSchedule, subjects }) {
  function updateSchedule(index, patch) {
    setSchedule((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  function addScheduleItem() {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 60 * 60000);
    setSchedule((current) => [...current, {
      subject: subjects[0]?.name || "Study",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      type: "study"
    }]);
  }
  return (
    <section className="panel wide">
      <PanelHeader title="Editable schedule output" onAdd={addScheduleItem} />
      <p className="hint">The backend returns the required JSON shape: subject, startTime, endTime, and type.</p>
      <div className="table">
        {schedule.map((item, index) => (
          <div className="schedule-row" key={`${item.startTime}-${index}`}>
            <input value={item.subject} onChange={(e) => updateSchedule(index, { subject: e.target.value })} />
            <input type="datetime-local" value={toLocalInput(item.startTime)} onChange={(e) => updateSchedule(index, { startTime: new Date(e.target.value).toISOString() })} />
            <input type="datetime-local" value={toLocalInput(item.endTime)} onChange={(e) => updateSchedule(index, { endTime: new Date(e.target.value).toISOString() })} />
            <select value={item.type} onChange={(e) => updateSchedule(index, { type: e.target.value })}>
              <option value="study">study</option>
              <option value="break">break</option>
            </select>
            <button className="ghost" onClick={() => setSchedule((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
          </div>
        ))}
      </div>
      <pre>{JSON.stringify(schedule.map(({ subject, startTime, endTime, type }) => ({ subject, startTime, endTime, type })), null, 2)}</pre>
    </section>
  );
}

function PanelHeader({ title, onAdd }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <button onClick={onAdd}>Add</button>
    </div>
  );
}

function DayPicker({ value, onChange }) {
  return (
    <div className="chips">
      {days.map((day, index) => (
        <button type="button" key={day} className={value.includes(index) ? "chip active" : "chip"} onClick={() => onChange(toggle(value, index))}>
          {day}
        </button>
      ))}
    </div>
  );
}

function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  });
  function setAndSave(next) {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  }
  return [value, setAndSave];
}

function validateInput(data) {
  const warnings = [];
  if (!data.subjects.length) warnings.push("Add at least one subject.");
  if (!data.assignments.length && !data.exams.length) warnings.push("Add at least one assignment or exam.");
  if (data.classes.some((item) => !item.subjectId)) warnings.push("Every class needs a subject.");
  if ([...data.classes, ...data.commitments].some((item) => !item.days?.length)) warnings.push("Every class and commitment needs at least one day.");
  return warnings;
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function toLocalInput(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

createRoot(document.getElementById("root")).render(<App />);
