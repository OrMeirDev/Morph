import React from 'react';
import PageHeader from '../../components/PageHeader.jsx';
import UnitConverter from './UnitConverter.jsx';
import WorldClock from '../clock/WorldClock.jsx';

export default function UnitsPage() {
  return (
    <>
      <PageHeader title="יחידות וזמן" subtitle="מחשבון המרות. מקלידים מספר ורואים את התוצאה מיד." />
      <div className="tools-grid">
        <UnitConverter />
        <WorldClock />
      </div>
    </>
  );
}
