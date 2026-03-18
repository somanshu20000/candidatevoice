import React from "react";

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <h1
        className="text-4xl font-bold mb-6"
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        CandidateVoice — Know the process before you apply
      </h1>
      <div className="flex space-x-4">
        <button className="px-4 py-2 bg-blue-600 text-white rounded">
          Share
        </button>
        <button className="px-4 py-2 bg-gray-200 text-black rounded">
          Browse
        </button>
      </div>
    </main>
  );
}
