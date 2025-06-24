import React from 'react';

const LaunchpadCTA: React.FC = () => {
  return (
    <section className="relative py-16 bg-green-500" style={{
      zIndex: 1000,
    }}>
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl font-bold text-black mb-4">
          🚀 Our New Launchpad is Live!
        </h2>
        <p className="text-lg text-black mb-6">
          Discover and participate in the latest token launches on TKNZ Launchpad.
        </p>
        <a
          href="https://launch.tknz.fun"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-black text-green-500 px-8 py-3 font-semibold rounded hover:bg-gray-800 transition"
        >
          Go to Launchpad
        </a>
      </div>
    </section>
  );
};

export default LaunchpadCTA;