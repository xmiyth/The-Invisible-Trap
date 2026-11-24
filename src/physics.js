// Educational, dimensionless mechanistic model. NOT a certified HEPA prediction.
// Competing capture mechanisms have qualitatively different size and airflow dependencies.
export function filtrationModel(sizeMicrons, airflow, density) {
  const d = Math.max(0.03, Number(sizeMicrons));
  const v = Math.max(0.45, Number(airflow));
  const f = Math.max(0.4, Number(density));
  // Tunable optical-depth contributions. The three processes operate in parallel.
  // Diffusion becomes more important for very small particles and slower flow.
  // Interception increases with particle-to-fiber size ratio.
  // Inertial impaction increases for larger particles at higher flow rates.
  const diffusion = 0.36 * f * (0.1 / d) ** 0.72 / v ** 0.5;
  const interception = 0.19 * f * (d / 0.3) ** 1.05;
  const impaction = 0.20 * f * (d / 0.5) ** 2.0 * v ** 1.18;
  const parts = { Diffusion: diffusion, Interception: interception, Impaction: impaction };
  const intensity = diffusion + interception + impaction;
  const efficiency = 100 * (1 - Math.exp(-intensity));
  const dominant = Object.entries(parts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
  const fractions = Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, value / intensity]));
  return { efficiency, intensity, dominant, parts, fractions };
}

export function roomModel(minutes, initial, roomArea, ceiling, fanFlow, efficiencyPercent) {
  const volume = roomArea * ceiling;
  const cadr = fanFlow * efficiencyPercent / 100;
  const cleanAirChanges = cadr / volume;
  return { volume, cadr, cleanAirChanges,
    concentration: initial * Math.exp(-cleanAirChanges * Math.max(0, minutes) / 60) };
}

export const examplePresets = {
  tiny: { size: 0.05, speed: 0.8, density: 1.0 },
  middle: { size: 0.3, speed: 1.0, density: 1.0 },
  large: { size: 1.5, speed: 1.5, density: 1.0 },
};
