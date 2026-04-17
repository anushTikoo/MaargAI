import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import FleetInfo from './pages/FleetInfo';
import Signup from './pages/Signup';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/fleet-info" element={<FleetInfo />} />
      </Routes>
    </Router>
  )
}

export default App
