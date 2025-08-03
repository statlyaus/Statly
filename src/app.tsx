import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Home from './pages/home';
import MyTeam from './pages/my-team';
import Tradecentre from './app/tradecentre/page';
import Stats from './pages/stats';
import DraftBoard from './pages/draft-board';

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
