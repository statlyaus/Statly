import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Home from './Pages/Home';
import MyTeam from './Pages/MyTeam';
import Tradecentre from './Pages/Tradecentre';
import Stats from './Pages/Stats';
import DraftBoard from './Pages/DraftBoard';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/myteam" element={<MyTeam />} />
        <Route path="/tradecentre" element={<Tradecentre />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/draft" element={<DraftBoard />} />
      </Routes>
    </Router>
  );
}

export default App;
