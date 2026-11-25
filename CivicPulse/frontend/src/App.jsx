import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

const API = "http://localhost:8080/api";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

function App() {
  const [incidents, setIncidents] = useState([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "POTHOLE",
    latitude: "12.9716",
    longitude: "77.5946",
    reports: "1",
    imageUrl: ""
  });

  const load = async () => {
    const r = await fetch(`${API}/incidents`);
    setIncidents(await r.json());
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    await fetch(`${API}/incidents`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        reports: Number(form.reports)
      })
    });
    setForm({...form, title: "", description: "", reports: "1"});
    load();
  };

  const resolve = async (id) => {
    await fetch(`${API}/incidents/${id}/resolve`, {method: "PATCH"});
    load();
  };

  const active = incidents.filter(x => !x.resolved);
  const critical = active.filter(x => x.priority === "CRITICAL" || x.priority === "HIGH");

  return (
    <div className="app">
      <header>
        <div>
          <h1>🚨 Dhwani</h1>
          <p>AI-Powered Predictive Urban Infrastructure Intelligence</p>
        </div>
        <div className="status">● SYSTEM ONLINE</div>
      </header>

      <section className="stats">
        <div><b>{active.length}</b><span>Active incidents</span></div>
        <div><b>{critical.length}</b><span>High/Critical</span></div>
        <div><b>{incidents.length}</b><span>Total reports</span></div>
      </section>

      <main>
        <section className="card map-card">
          <h2>Live City Problem Map</h2>
          <MapContainer center={[12.9716,77.5946]} zoom={13} className="map">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {active.map(i => (
              <Marker key={i.id} position={[i.latitude, i.longitude]}>
                <Popup>
                  <b>{i.title}</b><br/>
                  {i.type}<br/>
                  Priority: {i.priority}<br/>
                  Risk: {i.riskScore}<br/>
                  Reports: {i.reports}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>

        <section className="card">
          <h2>Report an Incident</h2>
          <form onSubmit={submit}>
            <input placeholder="Title" required value={form.title}
              onChange={e=>setForm({...form,title:e.target.value})}/>
            <textarea placeholder="Description" value={form.description}
              onChange={e=>setForm({...form,description:e.target.value})}/>
            <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
              {["POTHOLE","FLOODING","WATER_LEAKAGE","GARBAGE","STREETLIGHT","POWER_PROBLEM","PUBLIC_SAFETY","OTHER"]
                .map(x=><option key={x}>{x}</option>)}
            </select>
            <div className="row">
              <input type="number" step="any" placeholder="Latitude" value={form.latitude}
                onChange={e=>setForm({...form,latitude:e.target.value})}/>
              <input type="number" step="any" placeholder="Longitude" value={form.longitude}
                onChange={e=>setForm({...form,longitude:e.target.value})}/>
            </div>
            <input type="number" min="1" placeholder="Number of reports" value={form.reports}
              onChange={e=>setForm({...form,reports:e.target.value})}/>
            <input placeholder="Image URL (optional)" value={form.imageUrl}
              onChange={e=>setForm({...form,imageUrl:e.target.value})}/>
            <button>Submit & Analyze with AI</button>
          </form>
        </section>
      </main>

      <section className="card incidents">
        <h2>Incident Intelligence</h2>
        {incidents.map(i => (
          <article className={`incident ${i.resolved ? "resolved" : ""}`} key={i.id}>
            <div>
              <h3>{i.title}</h3>
              <p>{i.description}</p>
              <small>{i.type} · {new Date(i.createdAt).toLocaleString()}</small>
            </div>
            <div className="metrics">
              <span>Reports <b>{i.reports}</b></span>
              <span>Confidence <b>{Math.round(i.confidence*100)}%</b></span>
              <span>Risk <b>{i.riskScore}</b></span>
              <span>Priority <b>{i.priority}</b></span>
              <span>AI: {i.recommendation}</span>
              {!i.resolved && <button onClick={()=>resolve(i.id)}>Mark resolved</button>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export default App;
