import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DayList from './components/DayList';
import DayView from './components/DayView';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DayList />} />
          <Route path="/day/:date" element={<DayView />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
