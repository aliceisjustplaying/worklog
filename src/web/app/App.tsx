import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DayList from './components/DayList';
import DayView from './components/DayView';
import ProjectList from './components/ProjectList';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DayList />} />
          <Route path="/day/:date" element={<DayView />} />
          <Route path="/projects" element={<ProjectList />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
