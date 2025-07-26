import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore, collection, doc, setDoc, addDoc,
  onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteDoc, getDocs
} from 'firebase/firestore';

// Ensure Firebase config and app ID are available from the environment
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-movie-app'; // Use a default for local testing

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Shared Components ---

// Modal component for user interactions
const Modal = ({ children, onClose, title }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 relative">
        <h2 className="text-3xl font-bold text-teal-400 mb-6 text-center">{title}</h2>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
};

// --- List Naming Modal Component ---
const ListNamingModal = ({ onSave, onClose }) => {
  const [listName, setListName] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!listName.trim()) {
      setError("List name cannot be empty.");
      return;
    }
    onSave(listName.trim());
    onClose(); // Close modal after saving
  };

  return (
    <Modal onClose={onClose} title="Name Your New List">
      <div className="space-y-4">
        <input
          type="text"
          className="w-full p-3 rounded-lg bg-gray-900 text-white border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="e.g., My Watchlist, Action Flicks"
          value={listName}
          onChange={(e) => {
            setListName(e.target.value);
            setError('');
          }}
          onKeyPress={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={handleSave}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
        >
          Save List Name
        </button>
      </div>
    </Modal>
  );
};

// --- Confirm Delete Modal Component ---
const ConfirmDeleteModal = ({ onConfirm, onCancel, itemType, itemName }) => {
  return (
    <Modal onClose={onCancel} title={`Delete ${itemType}?`}>
      <p className="text-gray-300 text-center mb-6">
        Are you sure you want to delete <span className="font-bold text-white">"{itemName}"</span>?
        This action cannot be undone.
      </p>
      <div className="flex justify-around gap-4">
        <button
          onClick={onConfirm}
          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
};

// --- Note Editor Modal Component ---
const NoteEditorModal = ({ movie, onSave, onClose }) => {
  const [note, setNote] = useState(movie.note || '');

  const handleSave = () => {
    onSave(movie.title, note);
    onClose();
  };

  return (
    <Modal onClose={onClose} title={`Note for "${movie.title}"`}>
      <textarea
        className="w-full h-32 p-3 rounded-lg bg-gray-900 text-white border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 resize-y mb-4"
        placeholder="Add your notes about this movie here..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      ></textarea>
      <button
        onClick={handleSave}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
      >
        Save Note
      </button>
    </Modal>
  );
};

// --- Account Screen Component ---
const AccountScreen = ({ userId, onListCreated, setErrorMessage }) => {
  const fileInputRef = useRef(null);
  const [showListNamingModal, setShowListNamingModal] = useState(false);
  const [tempParsedMovies, setTempParsedMovies] = useState([]); // Store parsed movies temporarily

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

    setErrorMessage('');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        // Updated CSV parsing logic:
        // Splits by new line, filters empty lines.
        // For each line, splits by comma.
        // Extracts the second element (index 1) as title, and third (index 2) as URL.
        const parsedMovies = text.split('\n')
          .map(line => line.trim())
          .filter(line => line !== '')
          .map(line => {
            const parts = line.split(',');
            // Ensure there are enough parts for title and URL
            if (parts.length >= 3) {
              return {
                title: parts[1].trim(), // Second element is movie name
                note: '', // Initialize with empty note
                url: parts[2].trim() // Third element is website URL
              };
            }
            return null; // Return null for invalid lines
          })
          .filter(movie => movie !== null); // Filter out null entries

        if (parsedMovies.length === 0) {
          setErrorMessage("No valid movie titles found in the CSV file with the expected format (date,title,url).");
          return;
        }

        setTempParsedMovies(parsedMovies);
        setShowListNamingModal(true); // Show modal to name the list
      } catch (error) {
        console.error("Error processing file:", error);
        setErrorMessage("Failed to upload and process file. Please ensure it's a valid CSV.");
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''; // Clear file input
        }
      }
    };
    reader.onerror = () => {
      setErrorMessage("Error reading file.");
    };
    reader.readAsText(file);
  };

  const handleSaveNewList = async (listName) => {
    try {
      const movieListsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/movieLists`);
      const newListRef = await addDoc(movieListsCollectionRef, {
        name: listName,
        movies: tempParsedMovies,
        createdAt: new Date()
      });
      onListCreated(newListRef.id); // Notify parent about new list
      setTempParsedMovies([]); // Clear temporary movies
      setErrorMessage('');
    } catch (error) {
      console.error("Error saving new list:", error);
      setErrorMessage("Failed to save new list. Please try again.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gray-800 rounded-xl shadow-2xl w-full max-w-xl border border-gray-700">
      <h2 className="text-4xl font-extrabold text-center mb-6 text-teal-400">Welcome!</h2>
      <p className="text-center text-gray-300 mb-8">
        Upload a CSV file to create your first movie list.
      </p>

      <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600 w-full">
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
          Upload a CSV file with format: <span className="font-mono text-white">Date,Movie Title,URL</span> (e.g., "2023-01-15,Dune: Part Two,https://example.com/dune").
        </p>
      </div>

      {showListNamingModal && (
        <ListNamingModal
          onSave={handleSaveNewList}
          onClose={() => setShowListNamingModal(false)}
        />
      )}
    </div>
  );
};

// --- Main Screen Component ---
const MainScreen = ({ userId, onSelectList, setErrorMessage, onCreateNewList }) => {
  const [userLists, setUserLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null); // The list object for random generation
  const [randomMovie, setRandomMovie] = useState('');
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [listToDelete, setListToDelete] = useState(null);

  useEffect(() => {
    if (!userId) return;

    const movieListsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/movieLists`);
    const unsubscribe = onSnapshot(movieListsCollectionRef, (snapshot) => {
      const lists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUserLists(lists);
      if (!selectedList && lists.length > 0) {
        // Automatically select the first list if none is selected
        setSelectedList(lists[0]);
      } else if (selectedList) {
        // Update selectedList if its data changed or it was deleted
        const updatedSelectedList = lists.find(list => list.id === selectedList.id);
        if (updatedSelectedList) {
          setSelectedList(updatedSelectedList);
        } else {
          // If the previously selected list was deleted, clear selection
          setSelectedList(null);
          setRandomMovie('');
        }
      }
      setErrorMessage('');
    }, (error) => {
      console.error("Error fetching user lists:", error);
      setErrorMessage("Failed to load your movie lists. Please check your connection.");
    });

    return () => unsubscribe();
  }, [userId, selectedList]); // Re-run if userId changes or selectedList changes (to update its data)

  const generateMovieOfTheDay = () => {
    if (!selectedList || selectedList.movies.length === 0) {
      setErrorMessage("Please select a list with movies to generate a pick!");
      setRandomMovie('');
      return;
    }

    const randomIndex = Math.floor(Math.random() * selectedList.movies.length);
    setRandomMovie(selectedList.movies[randomIndex].title); // Access the title property
    setErrorMessage('');
  };

  const handleDeleteListClick = (list) => {
    setListToDelete(list);
    setShowConfirmDeleteModal(true);
  };

  const confirmDeleteList = async () => {
    if (!listToDelete || !userId) return;
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/movieLists`, listToDelete.id));
      setErrorMessage('');
      setRandomMovie(''); // Clear random movie if the list it came from is deleted
    } catch (error) {
      console.error("Error deleting list:", error);
      setErrorMessage("Failed to delete list. Please try again.");
    } finally {
      setShowConfirmDeleteModal(false);
      setListToDelete(null);
    }
  };

  return (
    <div className="flex flex-col items-center p-8 bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700">
      <h2 className="text-4xl font-extrabold text-center mb-6 text-teal-400">Your Movie Collections</h2>
      <p className="text-center text-gray-300 mb-8">
        Select a list to get a random movie, or manage your collections.
      </p>

      {/* List of User Lists */}
      <div className="w-full mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600">
        <h3 className="text-2xl font-semibold text-gray-200 mb-4 flex justify-between items-center">
          Your Lists
          <button
            onClick={onCreateNewList}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition duration-300 ease-in-out transform hover:scale-105"
          >
            + New List
          </button>
        </h3>
        {userLists.length === 0 ? (
          <p className="text-gray-400 text-center">No lists yet. Create one by uploading a CSV!</p>
        ) : (
          <ul className="space-y-3">
            {userLists.map((list) => (
              <li
                key={list.id}
                className={`flex justify-between items-center p-4 rounded-lg shadow-sm transition duration-200 ease-in-out
                            ${selectedList && selectedList.id === list.id ? 'bg-indigo-900 border-indigo-500' : 'bg-gray-900 hover:bg-gray-700 cursor-pointer border-gray-800'}`}
              >
                <div className="flex-grow flex items-center gap-3" onClick={() => onSelectList(list.id)}>
                  <span className="text-xl font-medium text-gray-100">{list.name}</span>
                  <span className="text-gray-400 text-sm">({list.movies.length} movies)</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedList(list)}
                    className={`p-2 rounded-full transition duration-200 ease-in-out
                                ${selectedList && selectedList.id === list.id ? 'bg-indigo-500 text-white' : 'text-gray-400 hover:text-indigo-400 hover:bg-gray-600'}`}
                    title="Select for random generation"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onSelectList(list.id)} // View details button
                    className="p-2 rounded-full text-gray-400 hover:text-blue-400 hover:bg-gray-600 transition duration-200 ease-in-out"
                    title="View/Manage List"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteListClick(list)}
                    className="p-2 rounded-full text-red-400 hover:text-red-600 hover:bg-red-900/20 transition duration-200 ease-in-out"
                    title="Delete list"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 01-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Generate Movie of the Day Section */}
      <div className="mt-4 text-center w-full">
        <p className="text-gray-300 mb-4">
          Selected List for Random Pick: <span className="font-bold text-white">{selectedList ? selectedList.name : 'None'}</span>
        </p>
        <button
          onClick={generateMovieOfTheDay}
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 text-xl"
        >
          ✨ Generate Movie of the Day ✨
        </button>
      </div>

      {/* Random Movie Display */}
      {randomMovie && (
        <div className="mt-8 p-6 bg-gray-700 rounded-xl shadow-inner border border-gray-600 w-full">
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

      {showConfirmDeleteModal && listToDelete && (
        <ConfirmDeleteModal
          onConfirm={confirmDeleteList}
          onCancel={() => setShowConfirmDeleteModal(false)}
          itemType="List"
          itemName={listToDelete.name}
        />
      )}
    </div>
  );
};

// --- List Detail Screen Component ---
const ListDetailScreen = ({ userId, listId, onBack, setErrorMessage }) => {
  const [list, setList] = useState(null);
  const [newMovieTitle, setNewMovieTitle] = useState('');
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [movieToDelete, setMovieToDelete] = useState(null);
  const [showNoteEditorModal, setShowNoteEditorModal] = useState(false);
  const [movieToEditNote, setMovieToEditNote] = useState(null);

  useEffect(() => {
    if (!userId || !listId) return;

    const listDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, listId);
    const unsubscribe = onSnapshot(listDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setList({ id: docSnap.id, ...docSnap.data() });
      } else {
        setErrorMessage("List not found or has been deleted.");
        onBack(); // Go back if list doesn't exist
      }
      setErrorMessage('');
    }, (error) => {
      console.error("Error fetching list details:", error);
      setErrorMessage("Failed to load list details. Please check your connection.");
    });

    return () => unsubscribe();
  }, [userId, listId, onBack]); // Depend on userId, listId, and onBack

  const handleAddMovie = async () => {
    if (!newMovieTitle.trim()) {
      setErrorMessage("Movie title cannot be empty.");
      return;
    }
    if (!userId || !listId) return;

    setErrorMessage('');
    try {
      const listDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, listId);
      // Add movie as an object with title and empty note, and empty URL
      await updateDoc(listDocRef, {
        movies: arrayUnion({ title: newMovieTitle.trim(), note: '', url: '' })
      });
      setNewMovieTitle('');
    } catch (error) {
      console.error("Error adding movie:", error);
      setErrorMessage("Failed to add movie. Please try again.");
    }
  };

  const handleDeleteMovieClick = (movie) => {
    setMovieToDelete(movie);
    setShowConfirmDeleteModal(true);
  };

  const confirmDeleteMovie = async () => {
    if (!movieToDelete || !userId || !listId) return;
    try {
      const listDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, listId);
      await updateDoc(listDocRef, {
        movies: arrayRemove(movieToDelete) // Remove the exact movie object
      });
      setErrorMessage('');
    } catch (error) {
      console.error("Error deleting movie:", error);
      setErrorMessage("Failed to delete movie. Please try again.");
    } finally {
      setShowConfirmDeleteModal(false);
      setMovieToDelete(null);
    }
  };

  const handleEditNote = async (movieTitle, newNote) => {
    if (!userId || !listId || !list) return;

    setErrorMessage('');
    try {
      // Find the movie and update its note
      const updatedMovies = list.movies.map(movie =>
        movie.title === movieTitle ? { ...movie, note: newNote } : movie
      );
      const listDocRef = doc(db, `artifacts/${appId}/users/${userId}/movieLists`, listId);
      await updateDoc(listDocRef, { movies: updatedMovies });
    } catch (error) {
      console.error("Error saving note:", error);
      setErrorMessage("Failed to save note. Please try again.");
    }
  };

  const handleOpenNoteEditor = (movie) => {
    setMovieToEditNote(movie);
    setShowNoteEditorModal(true);
  };


  if (!list) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700">
        <p className="text-xl text-gray-300">Loading list details...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-8 bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700">
      <div className="w-full flex justify-between items-center mb-6">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-lg">Back to Lists</span>
        </button>
        <h2 className="text-4xl font-extrabold text-teal-400 text-center flex-grow">
          {list.name}
        </h2>
        <div className="w-16"></div> {/* Spacer for alignment */}
      </div>

      <p className="text-center text-gray-300 mb-8">
        Manage movies in your "{list.name}" list.
      </p>

      {/* Add New Movie Section */}
      <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600 w-full">
        <label htmlFor="new-movie" className="block text-lg font-medium text-gray-200 mb-3">
          Add New Movie to "{list.name}":
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
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
          >
            Add
          </button>
        </div>
      </div>

      {/* Movie List Display */}
      <div className="mb-8 p-6 bg-gray-700 rounded-lg border border-gray-600 max-h-96 overflow-y-auto w-full">
        <h3 className="text-2xl font-semibold text-gray-200 mb-4">Movies in this List ({list.movies.length}):</h3>
        {list.movies.length === 0 ? (
          <p className="text-gray-400 text-center">No movies in this list yet. Add some!</p>
        ) : (
          <ul className="space-y-3">
            {list.movies.map((movie, index) => (
              <li key={movie.title + index} className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-gray-900 p-4 rounded-md shadow-sm">
                <div className="flex-grow">
                  <span className="text-gray-100 text-lg font-medium">{movie.title}</span>
                  {movie.url && (
                    <a
                      href={movie.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-blue-400 hover:underline text-sm mt-1"
                    >
                      View Link
                    </a>
                  )}
                  {movie.note && (
                    <p className="text-gray-400 text-sm mt-1 italic break-words max-w-full">
                      Note: {movie.note}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 mt-3 sm:mt-0 sm:ml-4">
                  <button
                    onClick={() => handleOpenNoteEditor(movie)}
                    className="p-2 rounded-full text-blue-400 hover:text-blue-600 hover:bg-blue-900/20 transition duration-200 ease-in-out"
                    title="Edit note"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteMovieClick(movie)}
                    className="p-2 rounded-full text-red-400 hover:text-red-600 hover:bg-red-900/20 transition duration-200 ease-in-out"
                    title="Delete movie"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 01-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showConfirmDeleteModal && movieToDelete && (
        <ConfirmDeleteModal
          onConfirm={confirmDeleteMovie}
          onCancel={() => setShowConfirmDeleteModal(false)}
          itemType="Movie"
          itemName={movieToDelete.title}
        />
      )}

      {showNoteEditorModal && movieToEditNote && (
        <NoteEditorModal
          movie={movieToEditNote}
          onSave={handleSaveNote}
          onClose={() => setShowNoteEditorModal(false)}
        />
      )}
    </div>
  );
};

// --- Main App Component ---
const App = () => {
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('loading'); // 'loading', 'account', 'main', 'listDetail'
  const [selectedListId, setSelectedListId] = useState(null); // ID of the list being viewed in detail
  const [errorMessage, setErrorMessage] = useState('');

  // Firebase Authentication setup
  useEffect(() => {
    const setupFirebase = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined') {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Firebase authentication error:", error);
        setErrorMessage("Failed to authenticate with Firebase. Please try again.");
        setLoading(false);
        setCurrentView('account'); // Fallback to account screen if auth fails
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
        // Check if user has any lists to decide initial view
        const movieListsCollectionRef = collection(db, `artifacts/${appId}/users/${user.uid}/movieLists`);
        const querySnapshot = await getDocs(movieListsCollectionRef);
        if (querySnapshot.empty) {
          setCurrentView('account'); // No lists, go to account/upload screen
        } else {
          setCurrentView('main'); // Has lists, go to main screen
        }
      } else {
        setUserId(null);
        setIsAuthReady(true);
        setCurrentView('account'); // No user, go to account screen
      }
      setLoading(false);
    });

    setupFirebase();
    return () => unsubscribeAuth();
  }, []); // Run once on component mount

  const handleListCreated = (newListId) => {
    setSelectedListId(newListId); // Select the newly created list
    setCurrentView('main'); // Go to main screen after list is created
  };

  const handleSelectList = (listId) => {
    setSelectedListId(listId);
    setCurrentView('listDetail');
  };

  const handleBackToMain = () => {
    setSelectedListId(null);
    setCurrentView('main');
  };

  const handleCreateNewListFromMain = () => {
    setCurrentView('account');
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
      {/* User ID Display - Always visible for debugging/sharing */}
      {userId && (
        <div className="absolute top-4 right-4 text-gray-400 text-xs p-2 bg-gray-700 rounded-md shadow-lg z-10">
          User ID: <span className="font-mono break-all">{userId}</span>
        </div>
      )}

      {/* Error Message Display (Global) */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white p-4 rounded-lg shadow-xl z-50 animate-fade-in-down">
          {errorMessage}
        </div>
      )}

      {currentView === 'account' && (
        <AccountScreen
          userId={userId}
          onListCreated={handleListCreated}
          setErrorMessage={setErrorMessage}
        />
      )}

      {currentView === 'main' && (
        <MainScreen
          userId={userId}
          onSelectList={handleSelectList}
          setErrorMessage={setErrorMessage}
          onCreateNewList={handleCreateNewListFromMain}
        />
      )}

      {currentView === 'listDetail' && selectedListId && (
        <ListDetailScreen
          userId={userId}
          listId={selectedListId}
          onBack={handleBackToMain}
          setErrorMessage={setErrorMessage}
        />
      )}
    </div>
  );
};

export default App;
