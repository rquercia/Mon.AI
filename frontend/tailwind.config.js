/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Roboto', 'sans-serif'],
            },
            colors: {
                // You can add additional custom colors here if needed, 
                // though we will use Tailwind's default palette for the specific colors requested.
                brand: {
                    light: '#f1f5f9', // slate-100
                    DEFAULT: '#6366f1', // indigo-500
                    dark: '#1e293b', // slate-800
                }
            },
            boxShadow: {
                'glass': '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
            }
        },
    },
    plugins: [],
}
