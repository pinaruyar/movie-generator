import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore, collection, doc, setDoc, getDoc,
  onSnapshot, updateDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';

// Ensure Firebase config and app ID are available from the environment
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-movie-app'; // Use a default for local testing

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Main App component
const App = () => {
  const [movies, setMovies] = useState([]); // State to hold the current list of movies
  const [randomMovie, setRandomMovie] = useState(''); // State for the "Movie of the Day"
  const [newMovieTitle, setNewMovieTitle] = useState(''); // State for the new movie input
  const [errorMessage, setErrorMessage] = useState(''); // State for error messages
  const [loading, setLoading] = useState(true); // Loading state for initial data fetch
  const [userId, setUserId] = useState(null); // User ID from Firebase Auth
  const [isAuthReady, setIsAuthReady] = useState(false); // Flag to ensure auth is ready before Firestore ops

  const fileInputRef = useRef(null); // Ref for the file input element

  // Effect for Firebase Authentication and Firestore Listener
  useEffect(() => {
    const setupFirebase = async () => {
      try {
        // Sign in with custom token if available, otherwise anonymously
        if (typeof __initial_auth_token !== 'undefined') {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Firebase authentication error:", error);
        setErrorMessage("Failed to authenticate with Firebase. Please try again.");
      }
    };

    // Listen for auth state changes
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        setUserId(null);
        setIsAuthReady(true); // Still set to true even if no user, to proceed with anonymous
      }
      setLoading(false); // Authentication process is done
    });

    setupFirebase();

    // Cleanup function for auth listener
    return () => unsubscribeAuth();
  }, []); // Run once on component mount

  // Effect for fetching and listening to movie data from Firestore
  useEffect(() => {
    let unsubscribeFirestore = () => {}; // Initialize as a no-op function

    if (isAuthReady && userId) {
      // Define the document path for the user's private watchlist
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, 'myWatchlist');

      // Set up a real-time listener for the user's watchlist document
      unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          // If the document exists, update the movies state with its 'movies' array
          setMovies(docSnap.data().movies || []);
        } else {
          // If the document doesn't exist, initialize an empty array
          setMovies([]);
          // Optionally, create the document if it doesn't exist
          setDoc(userDocRef, { movies: [] }).catch(e => console.error("Error creating watchlist doc:", e));
        }
        setErrorMessage(''); // Clear any previous errors
      }, (error) => {
        console.error("Error fetching watchlist from Firestore:", error);
        setErrorMessage("Failed to load your movie list. Please check your connection.");
      });
    } else if (isAuthReady && !userId) {
      // If auth is ready but no userId (e.g., anonymous sign-in failed or not yet resolved),
      // we might want to handle this case, perhaps by showing a message or allowing local-only use.
      // For now, we'll just set movies to empty and clear loading.
      setMovies([]);
      setLoading(false);
    }

    // Cleanup function for Firestore listener
    return () => unsubscribeFirestore();
  }, [isAuthReady, userId]); // Re-run when auth state or user ID changes

  /**
   * Handles CSV file upload.
   * Parses the CSV and updates the movie list in Firestore.
   * @param {Object} event - The file input change event.
   */
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      setErrorMessage("No file selected.");
      return;
    }

    if (!userId) {
      setErrorMessage("Authentication not ready. Please wait or refresh.");
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setRandomMovie(''); // Clear random movie when a new list is uploaded

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        // Simple CSV parsing: split by new line, then by comma (or just take the whole line)
        // Assuming each line is a movie title or "title,year"
        const parsedMovies = text.split('\n')
          .map(line => line.trim().split(',')[0].trim()) // Take the first part before comma
          .filter(movie => movie !== '');

        if (parsedMovies.length === 0) {
          setErrorMessage("No valid movie titles found in the CSV file.");
          setLoading(false);
          return;
        }

        const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, 'myWatchlist');
        // Overwrite the existing list with the new one from CSV
        await setDoc(userDocRef, { movies: parsedMovies });
        setErrorMessage('');
      } catch (error) {
        console.error("Error processing file or updating Firestore:", error);
        setErrorMessage("Failed to upload and process file. Please ensure it's a valid CSV.");
      } finally {
        setLoading(false);
        // Clear the file input value so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.onerror = () => {
      setErrorMessage("Error reading file.");
      setLoading(false);
    };
    reader.readAsText(file);
  };

  /**
   * Adds a new movie to the list and updates Firestore.
   */
  const handleAddMovie = async () => {
    if (!newMovieTitle.trim()) {
      setErrorMessage("Movie title cannot be empty.");
      return;
    }
    if (!userId) {
      setErrorMessage("Authentication not ready. Please wait or refresh.");
      return;
    }

    setErrorMessage('');
    setRandomMovie(''); // Clear random movie when adding a new one
    try {
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, 'myWatchlist');
      await updateDoc(userDocRef, {
        movies: arrayUnion(newMovieTitle.trim()) // Add the new movie to the array
      });
      setNewMovieTitle(''); // Clear input field
    } catch (error) {
      console.error("Error adding movie:", error);
      setErrorMessage("Failed to add movie. Please try again.");
    }
  };

  /**
   * Deletes a movie from the list and updates Firestore.
   * @param {string} movieToDelete - The title of the movie to delete.
   */
  const handleDeleteMovie = async (movieToDelete) => {
    if (!userId) {
      setErrorMessage("Authentication not ready. Please wait or refresh.");
      return;
    }

    setErrorMessage('');
    setRandomMovie(''); // Clear random movie if a movie is deleted
    try {
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, 'myWatchlist');
      await updateDoc(userDocRef, {
        movies: arrayRemove(movieToDelete) // Remove the movie from the array
      });
    } catch (error) {
      console.error("Error deleting movie:", error);
      setErrorMessage("Failed to delete movie. Please try again.");
    }
  };

  /**
   * Generates a random "Movie of the Day" from the current list.
   */
  const generateMovieOfTheDay = () => {
    if (movies.length === 0) {
      setErrorMessage("Your movie list is empty. Please add some movies first!");
      setRandomMovie('');
      return;
    }

    const randomIndex = Math.floor(Math.random() * movies.length);
    setRandomMovie(movies[randomIndex]);
    setErrorMessage(''); // Clear error on successful generation
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <p className="text-xl">Loading application...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white font-inter p-4 flex flex-col items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700">
        <h1 className="text-4xl font-extrabold text-center mb-6 text-teal-400">
          🎬 Your Movie List Manager
        </h1>
        <p className="text-center text-gray-300 mb-8">
          Upload your movie list, manage it, and get a random "Movie of the Day"!
        </p>

        {/* User ID Display */}
        {userId && (
          <div className="text-center text-gray-400 text-sm mb-6 p-2 bg-gray-700 rounded-md">
            Your User ID: <span className="font-mono text-xs break-all">{userId}</span>
          </div>
        )}

        {/* Error Message Display */}
        {errorMessage && (
          <div className="bg-red-600 text-white p-4 rounded-lg mb-6 text-center shadow-md">
            {errorMessage}
          </div>
        )}

        {/* CSV Upload Section */}
        <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600">
          <label htmlFor="csv-upload" className="block text-lg font-medium text-gray-200 mb-3">
            Upload Movie List (CSV):
          </label>
          <input
            type="file"
            id="csv-upload"
            accept=".csv"
            onChange={handleFileUpload}
            ref={fileInputRef}
            className="block w-full text-sm text-gray-300
                       file:mr-4 file:py-2 file:px-4
                       file:rounded-full file:border-0
                       file:text-sm file:font-semibold
                       file:bg-indigo-500 file:text-white
                       hover:file:bg-indigo-600 cursor-pointer"
          />
          <p className="text-gray-400 text-xs mt-2">
            Upload a CSV file where each line contains a movie title (e.g., "Movie Title,Year").
            Only the first part before a comma will be used.
          </p>
        </div>

        {/* Add New Movie Section */}
        <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600">
          <label htmlFor="new-movie" className="block text-lg font-medium text-gray-200 mb-3">
            Add New Movie:
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              id="new-movie"
              className="flex-grow p-3 rounded-lg bg-gray-900 text-white border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter movie title"
              value={newMovieTitle}
              onChange={(e) => setNewMovieTitle(e.target.value)}
              onKeyPress={(e) => { if (e.key === 'Enter') handleAddMovie(); }}
            />
            <button
              onClick={handleAddMovie}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              Add
            </button>
          </div>
        </div>

        {/* Movie List Display */}
        <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600 max-h-80 overflow-y-auto">
          <h2 className="text-2xl font-semibold text-gray-200 mb-4">Your Current Movie List ({movies.length}):</h2>
          {movies.length === 0 ? (
            <p className="text-gray-400 text-center">No movies in your list yet. Upload a CSV or add some!</p>
          ) : (
            <ul className="space-y-2">
              {movies.map((movie, index) => (
                <li key={movie + index} className="flex justify-between items-center bg-gray-900 p-3 rounded-md shadow-sm">
                  <span className="text-gray-100 text-lg">{movie}</span>
                  <button
                    onClick={() => handleDeleteMovie(movie)}
                    className="text-red-400 hover:text-red-600 transition duration-200 ease-in-out font-bold text-sm p-1 rounded-full hover:bg-red-900/20"
                    title="Delete movie"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 01-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Generate Movie of the Day Section */}
        <div className="mt-8 text-center">
          <button
            onClick={generateMovieOfTheDay}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 text-xl"
          >
            ✨ Generate Movie of the Day ✨
          </button>
        </div>

        {/* Random Movie Display */}
        {randomMovie && (
          <div className="mt-8 p-6 bg-gray-700 rounded-xl shadow-inner border border-gray-600">
            <h2 className="text-2xl font-semibold text-center text-gray-200 mb-4">
              Your Random Pick Is:
            </h2>
            <p className="text-5xl font-extrabold text-center text-purple-400 animate-pulse-once">
              "{randomMovie}"
            </p>
            <p className="text-center text-gray-400 mt-4">
              Time to watch!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
